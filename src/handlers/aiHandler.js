const { askAI } = require("../ai/ollama");
const { setAwaitingBuktiTf, CS_SENIOR_JID } = require("./commandHandler");
const { logger, maskPhone } = require("../utils/logger");
const path = require("path");
const fs = require("fs");

const GAMBAR_DIR = path.join(__dirname, "../../gambar");

// Pattern untuk mendeteksi kalau AI sudah mengirim rekening DP desain.
// Pakai nomor rekening atau nama CV — keduanya unik dan susah false-positive.
const REKENING_PATTERN = /(731[-\s]?5250889|ayres\s*sportindo)/i;

// Pattern untuk mendeteksi escalation nego ke CS Senior. AI di prompt diinstruksikan
// pakai frasa "teruskan ke CS Senior" — itu jadi marker untuk trigger notify.
const NEGO_ESCALATION_PATTERN = /teruskan(?:nya)?\s+(?:ke\s+)?CS\s*Senior/i;

const FALLBACK_TIMEOUT =
  "Maaf kak, sistem saya lagi sibuk. Coba tanyakan lagi dalam beberapa saat ya 🙏";
const FALLBACK_ERROR =
  "Maaf kak, ada gangguan teknis. Coba lagi sebentar ya, atau ketik admin untuk dibantu langsung.";
const ADMIN_IMAGE_FOLLOWUP_REPLY =
  "Baik kak, nanti akan ada admin yang memberikan updatean selanjutnya.";
const EXPRESS_LOAD_NOTE =
  "Note: penerimaan express menyesuaikan load produksi, jadi tidak semua request express bisa kami terima ya kak.";

// Daftar folder gambar yang bisa dikirim otomatis oleh AI
// key: regex untuk mendeteksi dari reply AI, value: info folder + caption
const IMAGE_TRIGGERS = [
  {
    pattern: /berikut.*(promo|promosi)/i,
    folder: "Promo",
    text: "Berikut kak untuk promo bulan ini, mau pilih paket yang mana nih kak sebelum kehabisan 😁",
  },
  {
    pattern: /berikut.*(size chart boxy|sizechart boxy|ukuran boxy)/i,
    folder: "Size Chart Boxy",
    text: "Ini size chart jersey *boxy* Ayres Apparel kak! 📏\n\nJersey boxy punya potongan yang lebih longgar dan tampilan lebih kasual.\nKalau masih bingung mau pilih ukuran berapa, jangan ragu tanya ya 😊",
  },
  {
    pattern: /berikut.*(size chart|sizechart|ukuran)/i,
    folder: "Size Chart",
    text: "Ini size chart jersey Ayres Apparel kak! 📏\n\nTersedia ukuran reguler dan oversize ya kak.\nKalau masih bingung pilih ukuran yang pas, jangan ragu tanya ya 😊",
  },
];

function getImagesFromFolder(folderName, prefixText = "") {
  const folderPath = path.join(GAMBAR_DIR, folderName);
  if (!fs.existsSync(folderPath)) return [];
  const files = fs
    .readdirSync(folderPath)
    .filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f))
    .sort();
  return files.map((f, i) => ({
    path: path.join(folderPath, f),
    caption: i === 0 ? prefixText : "",
  }));
}

// Cek apakah reply AI bermaksud mengirim gambar yang ada di sistem
// Return { type: 'image', images, text } atau null
function detectImageIntent(rawReply) {
  for (const trigger of IMAGE_TRIGGERS) {
    if (trigger.pattern.test(rawReply)) {
      const images = getImagesFromFolder(trigger.folder, trigger.text);
      if (images.length > 0) {
        return { type: "image", images, text: null };
      }
    }
  }
  return null;
}

function normalizeReply(reply, userText = "") {
  if (!reply) return reply;

  let normalized = reply;
  const lowerUserText = (userText || "").toLowerCase();
  const asksForImage = [
    "gambar",
    "foto",
    "katalog",
    "contoh desain",
    "contoh",
    "size chart",
  ].some((k) => lowerUserText.includes(k));
  const promisesSendingImage =
    /(kirim|kirimkan|share).*(gambar|foto|contoh|hasil desain)/i.test(normalized) ||
    /(gambar|foto|contoh|hasil desain).*(kirim|kirimkan|share)/i.test(normalized) ||
    /berikut.*(gambar|foto|katalog|size chart|contoh|hasil desain)/i.test(normalized) ||
    /(gambar|foto|katalog|size chart|contoh|hasil desain).*(berikut|ini dia|terlampir)/i.test(normalized);
  const asksExpress =
    /(express|ekspres|urgent|produksi cepat|proses cepat|sehari jadi|1 hari|3 hari|5 hari|7 hari)/i.test(
      lowerUserText,
    );
  const hasExpressCapacityNote =
    /(load produksi|kapasitas produksi|menyesuaikan.*produksi|tidak semua.*express|cek.*produksi)/i.test(
      normalized,
    );

  // Guardrail: never promise sending image in fallback context.
  if (asksForImage && promisesSendingImage) {
    return ADMIN_IMAGE_FOLLOWUP_REPLY;
  }

  // Guardrail for a known awkward phrase.
  normalized = normalized.replace(
    /mau saya kirim gambarnya sekarang ya\s*\?*/gi,
    ADMIN_IMAGE_FOLLOWUP_REPLY,
  );

  if (asksExpress && !hasExpressCapacityNote) {
    normalized = `${normalized}\n\n${EXPRESS_LOAD_NOTE}`;
  }

  return normalized;
}

function buildNegoNotify(phone, customerMessage) {
  const trimmed = (customerMessage || "").slice(0, 500).trim();
  return {
    jid: CS_SENIOR_JID,
    message:
      "📞 *NEGO HARGA — perlu di-follow-up*\n\n" +
      `Customer chat: https://wa.me/${phone}\n` +
      `Pesan customer: "${trimmed}"\n\n` +
      "Bot sudah inform customer akan dikontak. Mohon segera chat customer langsung ya 🙏",
  };
}

// Return value:
//   string                                      → kirim sebagai teks biasa
//   { type: 'image', images, text, notify? }    → kirim gambar (text opsional)
//   { type: 'text', reply, notify }             → kirim teks + forward notify ke nomor internal
async function handleAI(phone, text) {
  try {
    logger.info({ phone: maskPhone(phone) }, "Sending to AI...");
    const rawReply = await askAI(phone, text);
    logger.info({ phone: maskPhone(phone) }, "AI replied successfully");

    // Jika AI sudah mengirim rekening DP desain, tandai customer sebagai awaiting bukti TF.
    // Setelah ini, bukti TF (gambar/teks "sudah transfer") akan otomatis diarahkan ke finance.
    if (REKENING_PATTERN.test(rawReply)) {
      setAwaitingBuktiTf(phone);
      logger.info(
        { phone: maskPhone(phone) },
        "Rekening DP terdeteksi di reply AI — awaiting bukti TF",
      );
    }

    // Detect escalation nego → kirim notify ke CS Senior (manusia chat customer langsung).
    let negoNotify = null;
    if (NEGO_ESCALATION_PATTERN.test(rawReply)) {
      negoNotify = buildNegoNotify(phone, text);
      logger.info(
        { phone: maskPhone(phone) },
        "Nego escalation terdeteksi — forwarding ke CS Senior",
      );
    }

    // Cek apakah AI bermaksud mengirim gambar yang tersedia di sistem
    const imageIntent = detectImageIntent(rawReply);
    if (imageIntent) {
      return negoNotify ? { ...imageIntent, notify: negoNotify } : imageIntent;
    }

    const normalized = normalizeReply(rawReply, text);
    if (negoNotify) {
      return { type: "text", reply: normalized, notify: negoNotify };
    }
    return normalized;
  } catch (err) {
    if (err.message === "TIMEOUT") {
      return FALLBACK_TIMEOUT;
    }
    logger.error({ phone: maskPhone(phone), err: err.message }, "AI handler error");
    return FALLBACK_ERROR;
  }
}

module.exports = { handleAI };
