const {
  handleCommand,
  isAwaitingBuktiTf,
  clearAwaitingBuktiTf,
  setAwaitingTfForm,
  BUKTI_TF_REPLY,
  FINANCE_JID,
} = require("../handlers/commandHandler");
const { handleAI } = require("../handlers/aiHandler");
const { isRateLimited, randomDelay } = require("../utils/throttle");
const { logger, maskPhone } = require("../utils/logger");
const fs = require("fs");
const path = require("path");

// Per-phone processing queue — prevents race conditions when same user sends multiple msgs
const phoneQueues = new Map();

function enqueueForPhone(phone, fn) {
  const prev = phoneQueues.get(phone) || Promise.resolve();
  const next = prev.then(fn).catch(() => {});
  phoneQueues.set(phone, next);
  next.finally(() => {
    if (phoneQueues.get(phone) === next) phoneQueues.delete(phone);
  });
  return next;
}

// Route incoming message to appropriate handler
async function routeMessage(sock, msg) {
  try {
    const jid = msg.key.remoteJid;

    // Skip group messages (only handle private chats)
    if (jid.endsWith("@g.us")) {
      logger.debug({ jid }, "Skipping group message");
      return;
    }

    // Skip broadcast and status
    if (jid === "status@broadcast" || jid.includes("broadcast")) return;

    // Deteksi apakah pesan berisi media (gambar/video/dokumen/sticker)
    const isMediaMessage =
      !!msg.message?.imageMessage ||
      !!msg.message?.videoMessage ||
      !!msg.message?.documentMessage ||
      !!msg.message?.stickerMessage;

    // Extract text from message
    const text =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      msg.message?.videoMessage?.caption ||
      "";

    // Jika pesan berupa media tanpa caption
    if (isMediaMessage && (!text || text.trim() === "")) {
      const phone = jid.replace("@s.whatsapp.net", "");

      // Jika customer sebelumnya sudah diberi rekening DP, anggap media ini sebagai bukti TF
      // dan arahkan ke admin finance.
      if (isAwaitingBuktiTf(phone)) {
        logger.info(
          { phone: maskPhone(phone) },
          "Media (bukti TF) received after DP rekening — redirecting to finance",
        );
        clearAwaitingBuktiTf(phone);
        setAwaitingTfForm(phone);
        await randomDelay();
        await sendMessage(sock, jid, BUKTI_TF_REPLY);

        // Auto-notify Finance: customer kirim image bukti TF
        try {
          await sock.sendMessage(FINANCE_JID, {
            text:
              "💰 *BUKTI TF CLAIM — perlu verifikasi* (image)\n\n" +
              `Customer chat: https://wa.me/${phone}\n` +
              "Customer kirim image bukti TF tanpa caption.\n\n" +
              "Mohon cek rekening BCA 731-5250889 untuk konfirmasi DP desain ya 🙏\n" +
              "Sambil verifikasi, customer di-arahkan untuk lengkapi form data. " +
              "Kalau sudah masuk, mohon kabari ke CS Order supaya bisa lanjut proses orderan.",
          });
          logger.info(
            { from: maskPhone(phone), to: FINANCE_JID },
            "Finance notify forwarded (bukti TF image)",
          );
        } catch (err) {
          logger.error(
            { jid: FINANCE_JID, err: err.message },
            "Failed to notify Finance for bukti TF image",
          );
        }
        return;
      }

      logger.info(
        { phone: maskPhone(phone) },
        "Media message received, replying with admin follow-up",
      );
      await randomDelay();
      await sendMessage(
        sock,
        jid,
        "Baik kak, referensi desainnya sudah kami terima 😊\nNanti admin kami yang akan chat kembali untuk bantu proses selanjutnya ya 🙏",
      );
      return;
    }

    if (!text || text.trim() === "") {
      logger.debug({ jid: maskPhone(jid) }, "Empty message, skipping");
      return;
    }

    const phone = jid.replace("@s.whatsapp.net", "");
    logger.info(
      { phone: maskPhone(phone), text: text.slice(0, 80) },
      "Incoming message",
    );

    // Rate limit check
    if (isRateLimited(phone)) {
      logger.warn({ phone: maskPhone(phone) }, "Rate limited");
      await sendMessage(
        sock,
        jid,
        "Kak, kamu terlalu banyak kirim pesan. Tunggu sebentar ya 😊",
      );
      return;
    }

    // Simulate typing delay (human-like)
    await randomDelay();

    // Check command rules first
    const commandResult = handleCommand(phone, text);
    if (commandResult.handled) {
      logger.info(
        { phone: maskPhone(phone) },
        `Command handled: "${text.slice(0, 30)}"`,
      );
      if (commandResult.type === "image") {
        // Kirim pesan teks terlebih dahulu jika ada
        if (commandResult.text) {
          await sendMessage(sock, jid, commandResult.text);
          await new Promise((r) => setTimeout(r, 400));
        }
        const sentCount = await sendImages(sock, jid, commandResult.images);
        if (sentCount === 0) {
          await sendMessage(
            sock,
            jid,
            "Maaf kak, gambar belum berhasil terkirim. Coba ulangi sekali lagi atau ketik admin ya 🙏",
          );
        }
      } else {
        await sendMessage(sock, jid, commandResult.reply);
      }

      // Notify aksi sekunder — forward data ke nomor internal (mis. CS Order)
      if (commandResult.notify?.jid && commandResult.notify?.message) {
        try {
          await sock.sendMessage(commandResult.notify.jid, {
            text: commandResult.notify.message,
          });
          logger.info(
            { from: maskPhone(phone), to: commandResult.notify.jid },
            "Notify forwarded",
          );
        } catch (err) {
          logger.error(
            { jid: commandResult.notify.jid, err: err.message },
            "Failed to send notify message",
          );
        }
      }

      return;
    }

    // Fall through to AI — enqueued per phone to avoid concurrent requests for same user
    await enqueueForPhone(phone, async () => {
      const aiResult = await handleAI(phone, text);

      // AI bisa return:
      //   string                                   → teks biasa
      //   { type: 'image', images, text, notify? } → gambar (+ notify opsional)
      //   { type: 'text', reply, notify }          → teks + notify ke nomor internal
      if (aiResult && typeof aiResult === "object" && aiResult.type === "image") {
        if (aiResult.text) {
          await sendMessage(sock, jid, aiResult.text);
          await new Promise((r) => setTimeout(r, 400));
        }
        const sentCount = await sendImages(sock, jid, aiResult.images);
        if (sentCount === 0) {
          await sendMessage(
            sock,
            jid,
            "Maaf kak, gambar belum berhasil terkirim. Coba ulangi sekali lagi atau ketik admin ya 🙏",
          );
        }
      } else if (aiResult && typeof aiResult === "object" && aiResult.type === "text") {
        await sendMessage(sock, jid, aiResult.reply);
      } else {
        await sendMessage(sock, jid, aiResult);
      }

      // Notify ke nomor internal (mis. CS Senior untuk nego escalation)
      if (
        aiResult &&
        typeof aiResult === "object" &&
        aiResult.notify?.jid &&
        aiResult.notify?.message
      ) {
        try {
          await sock.sendMessage(aiResult.notify.jid, {
            text: aiResult.notify.message,
          });
          logger.info(
            { from: maskPhone(phone), to: aiResult.notify.jid },
            "AI notify forwarded",
          );
        } catch (err) {
          logger.error(
            { jid: aiResult.notify.jid, err: err.message },
            "Failed to send AI notify message",
          );
        }
      }
    });
  } catch (err) {
    logger.error({ err: err.message }, "routeMessage error");
  }
}

async function sendMessage(sock, jid, text) {
  try {
    await sock.sendMessage(jid, { text });
  } catch (err) {
    logger.error({ jid, err: err.message }, "Failed to send message");
  }
}

async function sendImages(sock, jid, images) {
  let sentCount = 0;

  for (const img of images) {
    try {
      if (!img?.path || !fs.existsSync(img.path)) {
        logger.error({ jid, path: img?.path }, "Image file not found");
        continue;
      }

      const ext = path.extname(img.path).toLowerCase();
      const mimetype = getImageMimeType(ext);

      await sock.sendMessage(jid, {
        image: { url: img.path },
        caption: img.caption || "",
        mimetype,
        fileName: path.basename(img.path),
      });
      sentCount += 1;

      // Small delay between multiple images (anti-spam)
      if (images.length > 1) await new Promise((r) => setTimeout(r, 800));
    } catch (err) {
      logger.error(
        { jid, path: img.path, err: err.message },
        "Failed to send image",
      );
    }
  }

  return sentCount;
}

function getImageMimeType(ext) {
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".png":
    default:
      return "image/png";
  }
}

module.exports = { routeMessage };
