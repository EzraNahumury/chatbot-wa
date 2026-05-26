const { clearHistory } = require("../ai/ollama");
const path = require("path");
const fs = require("fs");

const GAMBAR_DIR = path.join(__dirname, "../../gambar");
const ADMIN_IMAGE_FOLLOWUP_REPLY =
  "Baik kak, nanti akan ada admin yang memberikan updatean selanjutnya.";
const JERSEY_DESIGN_IG_LINK = "https://www.instagram.com/ayres.sportswear/";
const DESIGN_SPECIFIC_REPLY =
  "Kalau contoh yang spesifik nanti admin akan menghubungi lagi ya kak. Mungkin bisa lihat contoh hasil design juga di link IG kami: " +
  JERSEY_DESIGN_IG_LINK;
const EXPRESS_REPLY =
  "Untuk paket express, tersedia beberapa opsi dengan tambahan biaya per pcs ya kak 😊\n\n" +
  "• Express 1 Hari — Logo printing, pola standar: +Rp75.000/pcs\n" +
  "• Express 3 Hari — Logo 3D tatami, pola standar: +Rp50.000/pcs\n" +
  "• Express 5 Hari — Logo 3D tatami, pecah pola*: +Rp30.000/pcs\n" +
  "• Express 7 Hari — Logo 3D tatami, pecah pola*: +Rp15.000/pcs\n" +
  "• Express 10-12 Hari — Logo 3D tatami, pecah pola*: +Rp10.000/pcs\n" +
  "*Pecah pola berlaku untuk paket Classic & Pro\n\n" +
  "*Penawaran diskon volume khusus Express 5 hari ke atas:*\n" +
  "- Order 30-49 pcs: diskon 50% biaya express\n" +
  "- Order 50 pcs ke atas: FREE biaya express 🎉\n" +
  "(Express 1 & 3 hari kuotanya hanya 20 pcs/hari, jadi biaya express tetap penuh ya kak)\n\n" +
  "Ketentuan: order harus masuk sebelum 12.00 WIB dengan kondisi full payment, fix design, dan data lengkap. Di atas jam 12.00 ikut kuota hari berikutnya ya.\n\n" +
  "Note: penerimaan express tetap menyesuaikan load produksi, jadi tidak semua request bisa langsung diterima. Nanti admin bantu cek dulu ke produksi ya kak 🙏\n\n" +
  "Kira-kira kakak butuh selesai dalam berapa hari?";

// Rule-based commands checked BEFORE sending to AI
// Returns { handled: true, reply: string }
//       | { handled: true, type: 'image', text?: string, images: [{path, caption}] }
//       | { handled: false }

// State: track users who are awaiting katalog category selection
const katalogState = new Map(); // phone -> 'awaiting_katalog'

// State: track users who are awaiting pricelist jersey selection
const pricelistJerseyState = new Map(); // phone -> 'awaiting_pricelist_jersey'

// State: track users who already received DP rekening, awaiting bukti TF
// Auto-expires after 24 hours. Persisted to disk so restart doesn't wipe it.
const awaitingBuktiTfState = new Map(); // phone -> timestamp
const BUKTI_TF_EXPIRY_MS = 24 * 60 * 60 * 1000;
const STATE_DIR = process.env.SESSION_DIR
  ? path.resolve(process.env.SESSION_DIR)
  : path.join(__dirname, "../../auth");
const STATE_FILE = path.join(STATE_DIR, "bukti_tf_state.json");

// State: customer sudah konfirmasi TF, sedang diminta isi form data (post-TF)
const awaitingTfFormState = new Map(); // phone -> timestamp
const TF_FORM_EXPIRY_MS = 24 * 60 * 60 * 1000;
const TF_FORM_STATE_FILE = path.join(STATE_DIR, "tf_form_state.json");

// State: customer sedang diminta kasih rating chatbot (post-form, sebelum handover ke CS Order)
const awaitingRatingState = new Map(); // phone -> timestamp
const RATING_EXPIRY_MS = 24 * 60 * 60 * 1000;
const RATING_STATE_FILE = path.join(STATE_DIR, "rating_state.json");
const RATING_LOG_FILE = path.join(STATE_DIR, "ratings.jsonl");

function ensureStateDir() {
  try {
    if (!fs.existsSync(STATE_DIR)) {
      fs.mkdirSync(STATE_DIR, { recursive: true });
    }
  } catch (_) {}
}

function loadBuktiTfState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return;
    const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    const now = Date.now();
    for (const [phone, ts] of Object.entries(data)) {
      if (typeof ts === "number" && now - ts <= BUKTI_TF_EXPIRY_MS) {
        awaitingBuktiTfState.set(phone, ts);
      }
    }
  } catch (_) {}
}

function saveBuktiTfState() {
  try {
    ensureStateDir();
    const obj = Object.fromEntries(awaitingBuktiTfState);
    fs.writeFileSync(STATE_FILE, JSON.stringify(obj));
  } catch (_) {}
}

function loadTfFormState() {
  try {
    if (!fs.existsSync(TF_FORM_STATE_FILE)) return;
    const data = JSON.parse(fs.readFileSync(TF_FORM_STATE_FILE, "utf-8"));
    const now = Date.now();
    for (const [phone, ts] of Object.entries(data)) {
      if (typeof ts === "number" && now - ts <= TF_FORM_EXPIRY_MS) {
        awaitingTfFormState.set(phone, ts);
      }
    }
  } catch (_) {}
}

function saveTfFormState() {
  try {
    ensureStateDir();
    const obj = Object.fromEntries(awaitingTfFormState);
    fs.writeFileSync(TF_FORM_STATE_FILE, JSON.stringify(obj));
  } catch (_) {}
}

function loadRatingState() {
  try {
    if (!fs.existsSync(RATING_STATE_FILE)) return;
    const data = JSON.parse(fs.readFileSync(RATING_STATE_FILE, "utf-8"));
    const now = Date.now();
    for (const [phone, ts] of Object.entries(data)) {
      if (typeof ts === "number" && now - ts <= RATING_EXPIRY_MS) {
        awaitingRatingState.set(phone, ts);
      }
    }
  } catch (_) {}
}

function saveRatingState() {
  try {
    ensureStateDir();
    const obj = Object.fromEntries(awaitingRatingState);
    fs.writeFileSync(RATING_STATE_FILE, JSON.stringify(obj));
  } catch (_) {}
}

function appendRatingLog(phone, rating, comment) {
  try {
    ensureStateDir();
    const entry = {
      ts: new Date().toISOString(),
      phone,
      rating,
      comment: (comment || "").trim(),
    };
    fs.appendFileSync(RATING_LOG_FILE, JSON.stringify(entry) + "\n");
  } catch (_) {}
}

loadBuktiTfState();
loadTfFormState();
loadRatingState();

const FINANCE_NUMBER = "+62 882-2596-8185";

// Finance JID — tujuan auto-notify saat customer konfirmasi TF (parallel verify).
// Default derive dari FINANCE_NUMBER: 6288225968185 (tanpa + dan tanpa dash).
const FINANCE_JID = `${process.env.FINANCE_JID || "6288225968185"}@s.whatsapp.net`;

// CS Order — tujuan forward data customer setelah bukti TF & form diisi.
// Format JID Baileys: <country-code-no-plus><number>@s.whatsapp.net
const CS_ORDER_NUMBER_DISPLAY = process.env.CS_ORDER_NUMBER_DISPLAY || "+62 878-9855-5117";
const CS_ORDER_JID = `${process.env.CS_ORDER_JID || "6287898555117"}@s.whatsapp.net`;

// CS Senior — tujuan forward nego harga. Default sama dengan CS Order (087898555117),
// tapi bisa di-set terpisah via env CS_SENIOR_JID kalau nantinya peran dipisah.
const CS_SENIOR_JID = `${process.env.CS_SENIOR_JID || "6287898555117"}@s.whatsapp.net`;

const BUKTI_TF_REPLY =
  "Terima kasih banyak ya kak 🙏\n\n" +
  `Mohon dipastikan bukti transaksinya sudah dikirim ke admin finance kami di ${FINANCE_NUMBER} ya kak supaya bisa segera dikonfirmasi.\n\n` +
  "Sambil menunggu konfirmasi finance, mohon dilengkapi data berikut ya kak supaya orderannya bisa langsung kami teruskan ke CS Order 🙏\n\n" +
  "*FORM DATA CUSTOMER*\n\n" +
  "Nama : \n" +
  "No WA : \n" +
  "Alamat lengkap : \n" +
  "Jumlah TF : \n\n" +
  "Cukup balas pesan ini dengan format di atas ya kak. Setelah itu CS Order kami yang akan langsung kontak kakak untuk lanjut proses 😊";

// Greeting variants — anti-template, pick random. Promo slot via PROMO_TAGLINE env.
const GREETING_VARIANTS = [
  "Halo kak 👋 saya Nadia dari CS Ayres.{promo} Kira-kira ada kebutuhan apa yang bisa saya bantu hari ini?",
  "Halo kak, saya Nadia CS Ayres 😊{promo} Lagi cari jersey custom atau ada yang ingin ditanyakan dulu?",
  "Hai kak, Nadia dari Ayres Apparel di sini 🙏{promo} Boleh tahu ada keperluan apa yang bisa kami bantu?",
  "Halo kak 😊 saya Nadia CS Ayres.{promo} Mau bikin jersey untuk tim atau ada info produk yang ingin ditanyakan dulu?",
];

function buildGreetingReply() {
  const variant =
    GREETING_VARIANTS[Math.floor(Math.random() * GREETING_VARIANTS.length)];
  const raw = (process.env.PROMO_TAGLINE || "").trim();
  const promo = raw ? ` ${raw}` : "";
  return variant.replace("{promo}", promo);
}

function setAwaitingBuktiTf(phone) {
  awaitingBuktiTfState.set(phone, Date.now());
  saveBuktiTfState();
}

function isAwaitingBuktiTf(phone) {
  const ts = awaitingBuktiTfState.get(phone);
  if (!ts) return false;
  if (Date.now() - ts > BUKTI_TF_EXPIRY_MS) {
    awaitingBuktiTfState.delete(phone);
    saveBuktiTfState();
    return false;
  }
  return true;
}

function clearAwaitingBuktiTf(phone) {
  awaitingBuktiTfState.delete(phone);
  saveBuktiTfState();
}

function setAwaitingTfForm(phone) {
  awaitingTfFormState.set(phone, Date.now());
  saveTfFormState();
}

function isAwaitingTfForm(phone) {
  const ts = awaitingTfFormState.get(phone);
  if (!ts) return false;
  if (Date.now() - ts > TF_FORM_EXPIRY_MS) {
    awaitingTfFormState.delete(phone);
    saveTfFormState();
    return false;
  }
  return true;
}

function clearAwaitingTfForm(phone) {
  awaitingTfFormState.delete(phone);
  saveTfFormState();
}

// Detect filled post-TF form. Strict: butuh 4 label (nama, no wa, alamat, jumlah tf)
// dengan value non-empty.
function isPostTfFormFilled(text) {
  const hasNama = /\bnama\s*:\s*\S/i.test(text);
  const hasWa = /\bno\.?\s*wa\s*:\s*\S/i.test(text);
  const hasAlamat = /\balamat(\s+lengkap)?\s*:\s*\S/i.test(text);
  const hasJumlah = /\bjumlah\s*tf\s*:\s*\S/i.test(text);
  return hasNama && hasWa && hasAlamat && hasJumlah;
}

function setAwaitingRating(phone) {
  awaitingRatingState.set(phone, Date.now());
  saveRatingState();
}

function isAwaitingRating(phone) {
  const ts = awaitingRatingState.get(phone);
  if (!ts) return false;
  if (Date.now() - ts > RATING_EXPIRY_MS) {
    awaitingRatingState.delete(phone);
    saveRatingState();
    return false;
  }
  return true;
}

function clearAwaitingRating(phone) {
  awaitingRatingState.delete(phone);
  saveRatingState();
}

// Extract rating (1-5) dari text. Sisa text dipakai sebagai komentar.
function parseRating(text) {
  if (!text) return null;
  const m = text.match(/(?<![\d])([1-5])(?![\d])/);
  if (!m) return null;
  const rating = parseInt(m[1], 10);
  const comment = text.replace(/(?<![\d])([1-5])(?![\d])/, "").trim();
  return { rating, comment };
}

function parsePostTfForm(text) {
  const grab = (re) => {
    const m = text.match(re);
    return m ? m[1].trim() : "";
  };
  return {
    nama: grab(/\bnama\s*:\s*(.+?)(?:\r?\n|$)/i),
    noWa: grab(/\bno\.?\s*wa\s*:\s*(.+?)(?:\r?\n|$)/i),
    alamat: grab(/\balamat(?:\s+lengkap)?\s*:\s*(.+?)(?:\r?\n|$)/i),
    jumlahTf: grab(/\bjumlah\s*tf\s*:\s*(.+?)(?:\r?\n|$)/i),
  };
}

const PRICELIST_JERSEY_CATEGORIES = [
  {
    id: 1,
    name: "Paket Standar",
    folder: "Paket Standar",
    keywords: ["standar", "standard"],
  },
  {
    id: 2,
    name: "Paket Classic",
    folder: "Paket Classic",
    keywords: ["classic", "klasik"],
  },
  {
    id: 3,
    name: "Paket Pro",
    folder: "Paket Pro",
    keywords: ["pro"],
  },
  {
    id: 4,
    name: "Warrior Combat",
    folder: "Warrior Combat",
    keywords: ["warrior", "combat"],
  },
  {
    id: 5,
    name: "Nusantara",
    folder: "Nusantara",
    keywords: ["nusantara"],
  },
  {
    id: 6,
    name: "Tambahan",
    folder: "Tambahan",
    keywords: ["tambahan", "extra", "biaya tambahan"],
  },
];

const KATALOG_CATEGORIES = [
  {
    id: 1,
    name: "Classic Adi Vira",
    folder: "katalog classic Adi Vira",
    keywords: ["adi vira", "adivira", "pilih 1", "nomor 1", "katalog 1"],
  },
  {
    id: 2,
    name: "Classic Cakra Vega",
    folder: "katalog classic Cakra Vega",
    keywords: ["cakra vega", "cakravega", "pilih 2", "nomor 2", "katalog 2"],
  },
  {
    id: 3,
    name: "Pro Bima Sena",
    folder: "katalog pro Bima Sena",
    keywords: ["bima sena", "bimasena", "pilih 3", "nomor 3", "katalog 3"],
  },
  {
    id: 4,
    name: "Pro Garuda Vastra",
    folder: "katalog pro Garuda Vastra",
    keywords: [
      "garuda vastra",
      "garudavastra",
      "pilih 4",
      "nomor 4",
      "katalog 4",
    ],
  },
];

// ─── Helper: Load semua gambar dari subfolder GAMBAR_DIR ──────────────────────
function getImagesFromFolder(folderName, firstCaption = "") {
  const folderPath = path.join(GAMBAR_DIR, folderName);
  if (!fs.existsSync(folderPath)) return [];
  const files = fs
    .readdirSync(folderPath)
    .filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f))
    .sort();
  return files.map((f, i) => ({
    path: path.join(folderPath, f),
    caption: i === 0 ? firstCaption : "",
  }));
}

// ─── Helper: Kembalikan response image, atau fallback teks jika folder kosong ─
function imageResponse(folderName, text, _fallbackMsg, firstCaption = "") {
  const images = getImagesFromFolder(folderName, firstCaption);
  if (images.length > 0) {
    return { handled: true, type: "image", text, images };
  }
  return { handled: true, reply: ADMIN_IMAGE_FOLLOWUP_REPLY };
}

// ─── Helper: Katalog ──────────────────────────────────────────────────────────
function getKatalogImages(folder, categoryName) {
  const folderPath = path.join(GAMBAR_DIR, "katalog", folder);
  if (!fs.existsSync(folderPath)) return [];
  const files = fs
    .readdirSync(folderPath)
    .filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f))
    .sort();
  return files.map((f, i) => ({
    path: path.join(folderPath, f),
    caption:
      i === 0
        ? `Ini katalog *${categoryName}* kak! 🔥\n\nSemua desain katalog kami tersedia dalam versi *lengan pendek* ya kak, tapi kalau mau *lengan panjang* juga bisa dibuatkan.\nKalau ada yang cocok, langsung kabarin kami ya 😊`
        : "",
  }));
}

function clearKatalogState(phone) {
  katalogState.delete(phone);
}

function clearPricelistJerseyState(phone) {
  pricelistJerseyState.delete(phone);
}

function getPricelistJerseyImages(subfolder, categoryName) {
  const folderPath = path.join(GAMBAR_DIR, "Pricelist Jersey", subfolder);
  if (!fs.existsSync(folderPath)) return [];
  const files = fs
    .readdirSync(folderPath)
    .filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f))
    .sort();
  return files.map((f, i) => ({
    path: path.join(folderPath, f),
    caption:
      i === 0
        ? `Ini pricelist *${categoryName}* kak! 💰\n\nKalau ada pertanyaan lebih lanjut, langsung tanya ya 😊`
        : "",
  }));
}

// ─── Helper: deteksi customer konfirmasi sudah transfer DP ───────────────────
// Dipakai hanya saat state awaitingBuktiTf aktif (gated, false-positive risk rendah).
// Match: (a) frasa eksplisit "sudah transfer/tf/bayar"; (b) konfirmasi pendek
// standalone "sudah", "sudah kak", "udah", "done", "ok sudah", dll.
function isBuktiTfConfirmation(lower) {
  const phraseKeywords = [
    "sudah transfer",
    "sudah ditransfer",
    "udah transfer",
    "telah transfer",
    "sudah tf",
    "udah tf",
    "sudah saya transfer",
    "udah saya transfer",
    "saya sudah transfer",
    "sudah saya tf",
    "saya sudah tf",
    "sudah bayar",
    "udah bayar",
    "sudah dibayar",
    "udah dibayar",
    "ini bukti",
    "ini buktinya",
    "buktinya kak",
    "buktinya min",
    "bukti tf",
    "bukti transfer",
    "bukti transaksi",
    "transfer sudah",
    "tf sudah",
    "sudah berhasil transfer",
    "udah berhasil transfer",
    "berhasil transfer",
    "sudah saya kirim bukti",
    "udah saya kirim bukti",
    "sudah kirim bukti",
    "udah kirim bukti",
  ];
  if (phraseKeywords.some((k) => lower.includes(k))) return true;

  // Standalone konfirmasi pendek — wajib match seluruh pesan setelah trim.
  // Examples: "sudah", "sudah kak", "udah ya", "done", "selesai".
  const cleaned = lower.trim().replace(/[!?.,]+$/g, "").trim();
  if (
    /^(sudah|udah|done|selesai|sip|siap)(\s+(kak|min|ya|aja|nih|dong|bos|bro|gan|sy|saya))?$/i.test(
      cleaned,
    )
  ) {
    return true;
  }

  // "ok sudah", "oke sudah", "okey sudah"
  if (/^(ok|oke|okey|okay)\s+(sudah|udah)(\s+(kak|min|ya|aja))?$/i.test(cleaned)) {
    return true;
  }

  return false;
}

// ─── Main handler ─────────────────────────────────────────────────────────────
function handleCommand(phone, text) {
  const lower = text.trim().toLowerCase();

  // ── Ping ────────────────────────────────────────────────────────────────────
  if (lower === "ping") {
    return { handled: true, reply: "pong 🏓" };
  }

  // ── Bukti TF: customer mengkonfirmasi transfer setelah rekening dikirim ─────
  // Hanya aktif jika state awaitingBuktiTf di-set (artinya AI sudah kirim rekening).
  // Setelah konfirmasi: bot kirim FORM DATA CUSTOMER, set state awaitingTfForm,
  // DAN auto-notify Finance agar paralel mulai verifikasi rekening BCA.
  if (isAwaitingBuktiTf(phone) && isBuktiTfConfirmation(lower)) {
    clearAwaitingBuktiTf(phone);
    setAwaitingTfForm(phone);

    const financeMessage =
      "💰 *BUKTI TF CLAIM — perlu verifikasi*\n\n" +
      `Customer chat: https://wa.me/${phone}\n` +
      `Pesan konfirmasi customer: "${text.slice(0, 300)}"\n\n` +
      "Mohon cek rekening BCA 731-5250889 untuk konfirmasi DP desain ya 🙏\n" +
      "Sambil verifikasi, customer di-arahkan untuk lengkapi form data. " +
      "Kalau sudah masuk, mohon kabari ke CS Order supaya bisa lanjut proses orderan.";

    return {
      handled: true,
      reply: BUKTI_TF_REPLY,
      notify: {
        jid: FINANCE_JID,
        message: financeMessage,
      },
    };
  }

  // ── Rating customer: capture rating chatbot (post-form, untuk evaluasi)
  // Gated by state awaitingRating. Cek SEBELUM post-TF form handler supaya angka
  // yang dikirim customer di-treat sebagai rating, bukan form ulang.
  if (isAwaitingRating(phone)) {
    const parsed = parseRating(text);
    if (parsed) {
      appendRatingLog(phone, parsed.rating, parsed.comment);
      clearAwaitingRating(phone);
      return {
        handled: true,
        reply:
          `Terima kasih banyak ya kak untuk penilaiannya ⭐ (${parsed.rating}/5) 🙏\n\n` +
          "Masukan kakak akan kami pakai untuk terus perbaiki layanan chatbot. " +
          "Tinggal tunggu CS Order menghubungi ya kak untuk lanjut proses orderan 😊",
      };
    }
    // Tidak match angka rating → biarkan handler lain proses, state tetap aktif
  }

  // ── Filled Post-TF Form: customer kirim form data (nama, no wa, alamat, jumlah TF)
  // Gated by state awaitingTfForm. Setelah terisi → reply customer + notify CS Order +
  // minta rating sebagai langkah evaluasi.
  if (isAwaitingTfForm(phone) && isPostTfFormFilled(text)) {
    const form = parsePostTfForm(text);
    clearAwaitingTfForm(phone);
    setAwaitingRating(phone);

    const csOrderMessage =
      "📦 *ORDER BARU — Data customer sudah lengkap*\n\n" +
      `Customer chat: https://wa.me/${phone}\n` +
      `Nama: ${form.nama}\n` +
      `No WA: ${form.noWa}\n` +
      `Alamat lengkap: ${form.alamat}\n` +
      `Jumlah TF: ${form.jumlahTf}\n\n` +
      "⚠️ *Finance masih verifikasi bukti TF.* Mohon TUNGGU green light dari Finance sebelum mulai proses orderan ya 🙏\n" +
      "(Finance sudah ter-notify otomatis di awal saat customer konfirmasi TF)";

    return {
      handled: true,
      reply:
        "Mantap kak, data sudah kami terima 📝\n\n" +
        `Sebentar ya kak, CS Order kami (${CS_ORDER_NUMBER_DISPLAY}) akan langsung kontak kakak untuk lanjut proses orderan 🙏\n\n` +
        "Sebagai penutup, boleh kakak bantu kasih penilaian untuk chatbot kami? Cukup balas dengan angka *1-5* ya kak (1 = kurang banget, 5 = sangat memuaskan). Boleh tambahkan saran/komentar singkat juga kalau ada 😊\n\n" +
        "Penilaian ini sangat membantu kami untuk terus perbaiki layanan. Terima kasih banyak 🙏",
      notify: {
        jid: CS_ORDER_JID,
        message: csOrderMessage,
      },
    };
  }

  // ── Greeting / Menu ──────────────────────────────────────────────────────────
  // "menu" sengaja TIDAK di-include sebagai substring (akan false-positive
  // pada kata "menunggu", "menumpuk", dll.). Exact match "menu" tetap ditangani di bawah.
  const greetingKeywords = [
    "halo",
    "hai",
    "helo",
    "hello",
    "hi ",
    "hi,",
    "selamat pagi",
    "selamat siang",
    "selamat sore",
    "selamat malam",
    "assalamualaikum",
    "permisi",
    "p a g i",
  ];
  if (
    lower === "hi" ||
    lower === "menu" ||
    greetingKeywords.some((k) => lower.includes(k))
  ) {
    return {
      handled: true,
      reply: buildGreetingReply(),
    };
  }

  // ── Reset ────────────────────────────────────────────────────────────────────
  if (lower === "reset" || lower === "/reset") {
    clearHistory(phone);
    clearKatalogState(phone);
    clearPricelistJerseyState(phone);
    clearAwaitingBuktiTf(phone);
    return {
      handled: true,
      reply: "Okey, percakapan kita mulai dari awal ya 🙂",
    };
  }

  // ── Admin ────────────────────────────────────────────────────────────────────
  if (lower === "admin") {
    return {
      handled: true,
      reply:
        "Baik kak, saya hubungkan ke admin dulu ya. Mohon tunggu sebentar 🙏",
    };
  }

  // ── Order Intent — diprioritaskan sebelum semua state check ──────────────────
  // Jika customer menyatakan niat mau pesan, clear semua state dan arahkan ke proses order
  const orderIntentKeywords = [
    "mau pesan",
    "mau order",
    "ingin pesan",
    "ingin order",
    "saya pesan",
    "mau beli",
    "ingin beli",
    "saya order",
    "mulai pesan",
    "lanjut pesan",
    "lanjut order",
    "proses order",
    "mau lanjut",
    "lanjut aja",
    "oke pesan",
    "ok pesan",
    "jadi pesan",
  ];
  if (orderIntentKeywords.some((k) => lower.includes(k))) {
    // Order intent terdeteksi — clear state lalu serahkan ke AI supaya gali
    // kebutuhan customer secara natural (bertahap, sesuai konteks), bukan
    // dengan dumping form 9 poin.
    clearKatalogState(phone);
    clearPricelistJerseyState(phone);
    return { handled: false };
  }

  // ── Pricelist Jersey: step 2 — user sedang memilih paket ─────────────────────
  const expressKeywords = [
    "express",
    "ekspres",
    "urgent",
    "produksi cepat",
    "proses cepat",
    "sehari jadi",
    "1 hari",
    "3 hari",
    "5 hari",
    "7 hari",
  ];
  if (expressKeywords.some((k) => lower.includes(k))) {
    clearKatalogState(phone);
    clearPricelistJerseyState(phone);
    return {
      handled: true,
      reply: EXPRESS_REPLY,
    };
  }

  if (pricelistJerseyState.get(phone) === "awaiting_pricelist_jersey") {
    // Match by exact number first (e.g. "1", "1 kak"), then by keyword substring
    const numMatch = lower.match(/^([1-9])\b/);
    const inputNum = numMatch ? parseInt(numMatch[1], 10) : null;
    const matched = PRICELIST_JERSEY_CATEGORIES.find((cat) => {
      if (inputNum !== null && inputNum === cat.id) return true;
      return cat.keywords.some((kw) => lower.includes(kw));
    });
    if (matched) {
      pricelistJerseyState.delete(phone);
      const images = getPricelistJerseyImages(matched.folder, matched.name);
      if (images.length > 0) {
        return {
          handled: true,
          type: "image",
          text:
            `Ini pricelist *${matched.name}* ya kak 😊\n\n` +
            "Kalau mau lihat paket lain, ketik *pricelist* lagi ya.\n" +
            "Ada yang ingin ditanyakan? Langsung kabarin kami 🙏",
          images,
        };
      }
      return {
        handled: true,
        reply: ADMIN_IMAGE_FOLLOWUP_REPLY,
      };
    }
    // Pilihan tidak dikenali, tanya ulang
    return {
      handled: true,
      reply:
        "Maaf kak, pilihannya tidak dikenali 😅\n\n" +
        "Silakan ketik angka atau nama paket:\n" +
        "1️⃣ Paket Standar\n" +
        "2️⃣ Paket Classic\n" +
        "3️⃣ Paket Pro\n" +
        "4️⃣ Warrior Combat\n" +
        "5️⃣ Nusantara\n" +
        "6️⃣ Tambahan",
    };
  }

  // ── Deteksi konteks order — dipakai di beberapa cek di bawah ─────────────────
  const orderContextKeywordsGlobal = [
    "hitungkan",
    "tolong hitung",
    "hitung harga",
    "pemesanan",
    "mau pesan",
    "mau order",
    "ingin pesan",
    "ingin order",
    "sudah dikirim",
    "foto katalog",
    "mengikuti katalog",
    "sesuai katalog",
    "pakai katalog",
    "dari katalog",
    "ikutin katalog",
    "pcs",
    "stel",
    "qty",
    "pasang jersey",
    "deadline",
    "size xl",
    "size l",
    "size m",
    "size s",
    "nama dan nomor",
    "custom nama",
    "nomor punggung",
  ];
  const isOrderContextGlobal = orderContextKeywordsGlobal.some((k) =>
    lower.includes(k),
  );

  // ── Katalog: step 2 — user sedang memilih kategori ───────────────────────────
  if (katalogState.get(phone) === "awaiting_katalog") {
    // Jika ternyata user mengirim detail order, batalkan state katalog dan teruskan ke AI
    if (isOrderContextGlobal) {
      katalogState.delete(phone);
      return { handled: false };
    }
    // Match by exact number first (e.g. "1", "1 kak"), then by keyword substring
    const numMatch = lower.match(/^([1-9])\b/);
    const inputNum = numMatch ? parseInt(numMatch[1], 10) : null;
    const matched = KATALOG_CATEGORIES.find((cat) => {
      if (inputNum !== null && inputNum === cat.id) return true;
      return cat.keywords.some((kw) => lower.includes(kw));
    });
    if (matched) {
      katalogState.delete(phone);
      const images = getKatalogImages(matched.folder, matched.name);
      if (images.length > 0) {
        return { handled: true, type: "image", images };
      }
      return {
        handled: true,
        reply: ADMIN_IMAGE_FOLLOWUP_REPLY,
      };
    }
    return {
      handled: true,
      reply:
        "Maaf kak, pilihannya tidak dikenali 😅\n\n" +
        "Silakan ketik angka atau nama katalog yang diinginkan:\n" +
        "1️⃣ Adi Vira\n" +
        "2️⃣ Cakra Vega\n" +
        "3️⃣ Bima Sena\n" +
        "4️⃣ Garuda Vastra",
    };
  }

  // ── Pattern Lab: explanation + pancingan untuk lihat gambar pola ─────────────
  // Reuse state `awaiting_katalog` agar customer next reply (nama pola) langsung
  // dilayani oleh handler katalog di atas.
  const patternLabKeywords = [
    "pattern lab",
    "patternlab",
    "pola jersey",
    "pilihan pola",
    "katalog pola",
    "pola tim",
    "pola desain",
    "tipe pola",
  ];

  if (!isOrderContextGlobal && patternLabKeywords.some((k) => lower.includes(k))) {
    katalogState.set(phone, "awaiting_katalog");
    return {
      handled: true,
      reply:
        "Halo kak, mohon izin kami informasikan ya kak 🙏\n\n" +
        "Untuk pilihan pola jersey Ayres, kami menyediakan beberapa tipe pola yang bisa disesuaikan dengan karakter dan kebutuhan tim kakak. Setiap pola punya karakter tampilan yang berbeda — dari yang terlihat cepat, rapi, profesional, gagah, sampai memberi kesan kuat di lapangan.\n\n" +
        "*Pilihan pola yang tersedia:*\n\n" +
        "1️⃣ *Cakra Vega* — Classic Package\n" +
        "Cocok untuk tim yang ingin terlihat cepat, agresif, dan dinamis sejak awal laga.\n\n" +
        "2️⃣ *Adi Vira* — Classic Package\n" +
        "Cocok untuk tim yang ingin tampil lebih rapi, simple, dan profesional.\n\n" +
        "3️⃣ *Garuda Vastra* — Pro Package\n" +
        "Cocok untuk tim yang ingin terlihat lebih gagah, elegan, dan berbeda dari tim lain.\n\n" +
        "4️⃣ *Bima Sena* — Pro Package\n" +
        "Cocok untuk tim yang ingin memberi kesan kuat, solid, dan sulit ditaklukkan.\n\n" +
        "Pilihan pola ini jadi dasar bentuk panel, potongan, dan karakter desain jersey. Sedangkan warna, logo, sponsor, nama, nomor, dan detail identitas tim tetap akan disesuaikan pada tahap desain/proofing 🙏\n\n" +
        "_Catatan: setelah pola dipilih dan desain masuk tahap ACC proofing, pola dan data dianggap fix agar produksi berjalan aman sesuai timeline. Kalau ada perubahan pola/desain setelah ACC proofing, akan dilakukan penyesuaian ulang karena berpengaruh ke timeline produksi._\n\n" +
        "Mau lihat gambar polanya yang mana dulu kak? Ketik *Cakra Vega*, *Adi Vira*, *Garuda Vastra*, atau *Bima Sena* ya 😊",
    };
  }

  // ── Katalog: step 1 — user minta katalog ─────────────────────────────────────
  const katalogKeywords = [
    "katalog",
    "catalog",
    "daftar jersey",
    "pilihan jersey",
    "model jersey",
  ];

  if (!isOrderContextGlobal && katalogKeywords.some((k) => lower.includes(k))) {
    // Jika nama katalog spesifik sudah disebut di pesan yang sama, langsung kirim gambarnya
    const directKatalogMatch = KATALOG_CATEGORIES.find((cat) =>
      cat.keywords.some((kw) => lower.includes(kw)),
    );
    if (directKatalogMatch) {
      katalogState.delete(phone);
      const images = getKatalogImages(directKatalogMatch.folder, directKatalogMatch.name);
      if (images.length > 0) {
        return { handled: true, type: "image", images };
      }
      return { handled: true, reply: ADMIN_IMAGE_FOLLOWUP_REPLY };
    }

    katalogState.set(phone, "awaiting_katalog");
    return {
      handled: true,
      reply:
        "Hai kak! Kami punya 4 pilihan katalog jersey 🏀\n\n" +
        "1️⃣ Classic Adi Vira\n" +
        "2️⃣ Classic Cakra Vega\n" +
        "3️⃣ Pro Bima Sena\n" +
        "4️⃣ Pro Garuda Vastra\n\n" +
        "Ketik nama katalog yang ingin kamu lihat ya kak 😊\n\n" +
        "Untuk katalog design juga boleh cek di Instagram kami ya kak, disitu lengkap 😊\n" +
        "https://www.instagram.com/ayres.sportswear/",
    };
  }

  // ── Katalog: direct name mention tanpa state (misal: "cakra vega" langsung) ──
  const directCatalogRequest = KATALOG_CATEGORIES.find((cat) =>
    cat.keywords.some((kw) => lower.includes(kw)),
  );
  if (
    directCatalogRequest &&
    !isOrderContextGlobal &&
    /(gambar|foto|contoh|lihat|minta|kirim|katalog)/i.test(lower)
  ) {
    katalogState.delete(phone);
    const images = getKatalogImages(directCatalogRequest.folder, directCatalogRequest.name);
    if (images.length > 0) {
      return { handled: true, type: "image", images };
    }
    return { handled: true, reply: ADMIN_IMAGE_FOLLOWUP_REPLY };
  }

  // ── Size Chart Boxy (cek SEBELUM size chart biasa) ───────────────────────────
  const sizeBoxyKeywords = [
    "size chart boxy",
    "sizechart boxy",
    "ukuran boxy",
    "size boxy",
    "boxy size chart",
    "boxy size",
    "chart boxy",
    "ukuran baju boxy",
    "tabel ukuran boxy",
  ];
  if (sizeBoxyKeywords.some((k) => lower.includes(k))) {
    return imageResponse(
      "Size Chart Boxy",
      "Ini size chart jersey *boxy* Ayres Apparel kak! 📏\n\n" +
        "Jersey boxy punya potongan yang lebih longgar dan tampilan lebih kasual.\n" +
        "Kalau masih bingung mau pilih ukuran berapa, jangan ragu tanya ya 😊",
      "Maaf kak, size chart boxy belum tersedia. Hubungi admin untuk info ukuran ya 🙏",
    );
  }

  // ── Size Chart reguler ────────────────────────────────────────────────────────
  const sizeKeywords = [
    "size chart",
    "sizechart",
    "ukuran baju",
    "ukuran jersey",
    "tabel ukuran",
    "size baju",
    "size jersey",
    "ukuran size",
    "chart size",
    "minta ukuran",
    "lihat ukuran",
    "info ukuran",
  ];
  if (sizeKeywords.some((k) => lower.includes(k))) {
    return imageResponse(
      "Size Chart",
      "Ini size chart jersey Ayres Apparel kak! 📏\n\n" +
        "Tersedia dari size kids (anak-anak), dewasa reguler, sampai big size.\n" +
        "Kalau masih bingung pilih ukuran yang pas, jangan ragu tanya ya 😊",
      "Maaf kak, size chart belum tersedia saat ini. Hubungi admin untuk info ukuran ya 🙏",
    );
  }

  // ── Alur Pemesanan ────────────────────────────────────────────────────────────
  const alurKeywords = [
    "alur pemesanan",
    "alur order",
    "cara pesan",
    "cara order",
    "langkah pesan",
    "langkah order",
    "prosedur pesan",
    "prosedur order",
    "gimana cara pesan",
    "gimana order",
    "cara beli",
    "proses pesan",
    "proses order",
    "tahapan order",
    "tahapan pesan",
    "bagaimana pesan",
    "bagaimana order",
    "mau pesan gimana",
    "mau order gimana",
    "order gimana",
  ];
  if (alurKeywords.some((k) => lower.includes(k))) {
    return imageResponse(
      "Alur pemesanan",
      "Berikut alur pemesanan jersey Ayres Apparel ya kak 😊\n\n" +
        "Singkatnya begini:\n" +
        "1️⃣ Konsultasi kebutuhan (jenis jersey, qty, deadline)\n" +
        "2️⃣ Pilih desain dari katalog atau ajukan desain sendiri\n" +
        "3️⃣ DP desain Rp100.000 untuk mulai proses\n" +
        "4️⃣ Revisi desain hingga fix (maks 3x revisi)\n" +
        "5️⃣ DP produksi minimal 70% dari total tagihan\n" +
        "6️⃣ Produksi 21 hari kerja setelah ACC proofing\n" +
        "7️⃣ Pelunasan → barang dikemas & dikirim 🚚\n\n" +
        "Detail lengkapnya ada di gambar berikut ya kak 👇",
      "Maaf kak, gambar alur pemesanan belum tersedia. Hubungi admin untuk info lebih lanjut ya 🙏",
    );
  }

  // ── Bahan ─────────────────────────────────────────────────────────────────────
  const bahanKeywords = [
    "jenis bahan",
    "bahan apa",
    "bahannya",
    "bahan jersey",
    "bahan kain",
    "material jersey",
    "kain jersey",
    "info bahan",
    "pilihan bahan",
    "bahan drifit",
    "bahan kaos",
    "bahan yang",
    "tipe bahan",
    "bahan tersedia",
    "spek bahan",
    "spesifikasi bahan",
  ];
  if (bahanKeywords.some((k) => lower.includes(k))) {
    return imageResponse(
      "Bahan",
      "Jersey Ayres Apparel menggunakan bahan drifit polyester berkualitas kak 😊\n\n" +
        "Ada beberapa tier pilihan bahan:\n" +
        "🔹 *Standard Package* — ringan, nyaman, cocok aktivitas sehari-hari\n" +
        "🔹 *Classic Package* — kualitas lebih baik dengan fitur tambahan\n" +
        "🔹 *Pro Package* — premium, sirkulasi udara optimal\n" +
        "🔹 *Warrior Combat* — tier tertinggi, fitur paling lengkap\n\n" +
        "Semua bahan bersifat adem, menyerap keringat, dan warna tahan luntur karena pakai teknik sublimasi.\n\n" +
        "Detailnya ada di gambar berikut kak 👇",
      "Maaf kak, info gambar bahan belum tersedia. Hubungi admin untuk rekomendasi bahan ya 🙏",
    );
  }

  // ── Jenis Kerah ───────────────────────────────────────────────────────────────
  const kerahKeywords = [
    "jenis kerah",
    "pilihan kerah",
    "model kerah",
    "tipe kerah",
    "kerahnya",
    "bentuk kerah",
    "kerah apa",
    "kerah yang",
    "kerah jersey",
    "kerah baju",
  ];
  if (kerahKeywords.some((k) => lower.includes(k))) {
    return imageResponse(
      "jenis kerah",
      "Jersey Ayres bisa custom jenis kerah sesuai kebutuhan kak 😊\n\n" +
        "Ada beberapa pilihan bentuk kerah yang tersedia. Tinggal pilih sesuai selera tim ya!\n\n" +
        "Cek gambar berikut untuk melihat pilihan lengkapnya 👇",
      "Maaf kak, gambar jenis kerah belum tersedia. Hubungi admin untuk info lebih lanjut ya 🙏",
    );
  }

  // ── Logo 3D ───────────────────────────────────────────────────────────────────
  const logo3dKeywords = [
    "logo 3d",
    "3d logo",
    "logo timbul",
    "bordir logo",
    "contoh logo 3d",
    "logo 3 dimensi",
    "logo tiga dimensi",
    "logo emboss",
    "lihat logo 3d",
    "contoh 3d",
    "3d",
  ];
  if (logo3dKeywords.some((k) => lower.includes(k))) {
    return imageResponse(
      "Logo 3d",
      "Ini contoh logo 3D yang bisa ditambahkan pada jersey kak ✨\n\n" +
        "Logo 3D memberikan tampilan lebih premium dan eksklusif dibanding logo printing biasa.\n" +
        "Cocok untuk tim atau instansi yang ingin tampil lebih profesional 🔥\n\n" +
        "⚠️ *Penting:* Logo 3D *tidak tersedia untuk orderan satuan* ya kak.\n\n" +
        "Berikut ketentuan logo 3D:\n\n" +
        "🔹 *Tatami* — Minimal 6 pcs, tambahan Rp 20.000/pcs\n" +
        "   ✅ Order 12 pcs ke atas: *FREE logo tatami!*\n\n" +
        "🔹 *Flock* — Minimal 6 pcs, tambahan Rp 25.000/pcs\n\n" +
        "🔹 *Rubber* — Minimal 30 pcs, tambahan Rp 30.000/pcs\n\n" +
        "Untuk info lebih lanjut bisa konfirmasi ke admin ya kak 🙏",
      "Maaf kak, contoh gambar logo 3D belum tersedia. Hubungi admin untuk info lebih lanjut ya 🙏",
    );
  }

  // ── Pola / Pattern ────────────────────────────────────────────────────────────
  const polaKeywords = [
    "pola",
    "pattern",
    "motif jersey",
    "motif baju",
    "motif desain",
    "pilihan motif",
    "referensi motif",
    "contoh motif",
  ];
  if (polaKeywords.some((k) => lower.includes(k))) {
    return imageResponse(
      "Pola",
      "Untuk pola jersey, ada dua pilihan kak 😊\n\n" +
        "1️⃣ *Katalog Pola* — pilih dari pola yang sudah kami sediakan. Ada berbagai motif siap pakai yang tinggal dikombinasikan dengan warna dan identitas tim kakak.\n\n" +
        "2️⃣ *Full Custom* — kalau mau pola unik yang belum ada di katalog, tim desain Ayres bisa bantu buatkan dari nol. Cukup kirimkan ide, referensi gambar, atau konsep yang diinginkan.\n\n" +
        "Perlu diingat ya kak, kalau pola custom dari referensi, hasilnya mungkin tidak bisa 100% sama persis — tapi tim kami akan semaksimal mungkin menyesuaikan 🙏\n\n" +
        "Ini contoh referensi pola yang tersedia 👇",
      "Maaf kak, gambar pola belum tersedia. Hubungi admin untuk info lebih lanjut ya 🙏",
    );
  }

  // ── Pricelist Jersey ──────────────────────────────────────────────────────────
  const pricelistJerseyKeywords = [
    "pricelist jersey",
    "price list jersey",
    "pricelist baju",
    "daftar harga jersey",
    "harga paket jersey",
    "lihat pricelist",
    "minta pricelist",
    "kirim pricelist",
    "pricelist dong",
    "harga jersey",
    "harga baju",
    "info harga jersey",
    "cek harga jersey",
    "pricelist paket",
    "harga paket",
  ];
  if (pricelistJerseyKeywords.some((k) => lower.includes(k))) {
    pricelistJerseyState.set(phone, "awaiting_pricelist_jersey");
    return {
      handled: true,
      reply:
        "Hai kak! Berikut pilihan pricelist jersey Ayres Apparel 💰\n\n" +
        "1️⃣ Paket Standar\n" +
        "2️⃣ Paket Classic\n" +
        "3️⃣ Paket Pro\n" +
        "4️⃣ Warrior Combat\n" +
        "5️⃣ Nusantara\n" +
        "6️⃣ Tambahan\n\n" +
        "Ketik angka atau nama paket yang ingin kamu lihat ya kak 😊",
    };
  }

  // ── Pricelist Jaket ───────────────────────────────────────────────────────────
  const pricelistJaketKeywords = [
    "jaket",
    "jacket",
    "harga jaket",
    "pricelist jaket",
    "price jaket",
    "harga jacket",
    "pricelist jacket",
    "price list jaket",
    "price list jacket",
    "jaket berapa",
    "jaket harganya",
    "info jaket",
    "daftar harga jaket",
  ];
  if (pricelistJaketKeywords.some((k) => lower.includes(k))) {
    return imageResponse(
      "Pricelist Jaket",
      "Berikut pricelist jaket dari Ayres Apparel kak 😊\n\n" +
        "Jaket juga bisa custom desain sesuai kebutuhan tim atau komunitas ya.\n" +
        "Kalau ada pertanyaan soal spesifikasi, bahan, atau ketersediaan, langsung tanya aja 🙏\n\n" +
        "Detail harganya ada di sini 👇",
      "Maaf kak, gambar pricelist jaket belum tersedia. Hubungi admin untuk info harga ya 🙏",
    );
  }

  // ── Pricelist Makloon ─────────────────────────────────────────────────────────
  const pricelistMakloonKeywords = [
    "makloon",
    "maklun",
    "maklon",
    "pricelist makloon",
    "harga makloon",
    "price makloon",
    "jasa makloon",
    "layanan makloon",
    "makloon berapa",
    "daftar harga makloon",
    "info makloon",
  ];
  if (pricelistMakloonKeywords.some((k) => lower.includes(k))) {
    return imageResponse(
      "Pricelist Makloon",
      "Berikut informasi pricelist layanan makloon dari Ayres Apparel kak 😊\n\n" +
        "Layanan makloon tersedia untuk kamu yang sudah punya bahan sendiri dan hanya butuh proses produksinya saja.\n" +
        "Cocok untuk brand atau reseller yang mau produksi dalam jumlah banyak dengan biaya lebih efisien 💪\n\n" +
        "Detail harganya ada di sini 👇",
      "Maaf kak, gambar pricelist makloon belum tersedia. Hubungi admin untuk info lebih lanjut ya 🙏",
    );
  }

  // ── Promo ─────────────────────────────────────────────────────────────────────
  const promoKeywords = [
    "promo",
    "promosi",
    "diskon",
    "potongan harga",
    "penawaran",
    "special offer",
  ];
  if (promoKeywords.some((k) => lower.includes(k))) {
    return imageResponse(
      "Promo",
      "Berikut kak untuk promo bulan ini, mau pilih paket yang mana nih kak sebelum kehabisan 😁",
      "Maaf kak, info gambar promo belum tersedia. Hubungi admin untuk promo terkini ya 🙏",
    );
  }

  // ── COD ────────────────────────────────────────────────────────────────────────
  const codKeywords = [
    "cod",
    "cash on delivery",
    "bayar di tempat",
    "bayar ditempat",
    "bayar langsung",
    "bayar waktu terima",
    "bayar saat terima",
  ];
  if (codKeywords.some((k) => lower.includes(k))) {
    return {
      handled: true,
      reply:
        "Mohon maaf kak, sampai saat ini kita masih belum bisa melayani atau menerima pembayaran yang bersifat COD ya kak 🙏\n\n" +
        "Untuk pembayaran bisa melalui transfer bank BCA atau QRIS ya kak 😊",
    };
  }

  // ── Reseller ──────────────────────────────────────────────────────────────────
  const resellerKeywords = [
    "reseller",
    "mau jadi reseller",
    "harga reseller",
    "program reseller",
    "jadi reseller",
    "daftar reseller",
    "gabung reseller",
    "info reseller",
    "syarat reseller",
    "agen ayres",
  ];
  if (resellerKeywords.some((k) => lower.includes(k))) {
    return imageResponse(
      "Reseller",
      "Info program reseller Ayres Apparel ada di sini kak 😊\n\n" +
        "Reseller akan mendapatkan harga khusus setelah melakukan order sebanyak 2 kali.\n" +
        "Cocok untuk kamu yang mau bisnis jersey dengan modal kecil tapi keuntungan menarik 💰\n\n" +
        "Untuk syarat dan detail lengkapnya, cek gambar berikut ya 👇",
      "Maaf kak, gambar info reseller belum tersedia. Hubungi admin untuk info program reseller ya 🙏",
    );
  }

  // ── Referensi Warna ───────────────────────────────────────────────────────────
  const warnaKeywords = [
    "referensi warna",
    "pilihan warna",
    "warna bahan",
    "warna kain",
    "warna tersedia",
    "warna apa",
    "warna aja",
    "katalog warna",
    "lihat warna",
    "warna yang ada",
    "warna jersey",
    "warna baju",
    "daftar warna",
    "minta warna",
    "info warna",
  ];
  if (warnaKeywords.some((k) => lower.includes(k))) {
    return imageResponse(
      "Warna",
      "Berikut referensi pilihan warna bahan yang tersedia di Ayres Apparel kak 🎨\n\n" +
        "Yang perlu diketahui:\n" +
        "🖨️ *Warna printing* — tidak ada batasan, bisa semua warna sesuai desain\n" +
        "🧵 *Warna bahan dasar* — tersedia beberapa pilihan saja seperti yang ada di gambar\n\n" +
        "Kalau ada warna spesifik yang kamu inginkan, bisa dikonsultasikan dulu ya kak 😊",
      "Maaf kak, gambar referensi warna belum tersedia. Hubungi admin untuk info warna ya 🙏",
    );
  }

  // ── Contoh desain / hasil design ─────────────────────────────────────────────
  const designKeywords = [
    "contoh design",
    "contoh desain",
    "minta contoh desain",
    "minta contoh design",
    "boleh minta contoh",
    "minta contoh",
    "contoh dong",
    "ada contoh",
    "hasil design",
    "hasil desain",
    "referensi design",
    "referensi desain",
    "contoh jersey",
    "lihat desain",
    "lihat design",
  ];
  if (designKeywords.some((k) => lower.includes(k))) {
    return {
      handled: true,
      reply: DESIGN_SPECIFIC_REPLY,
    };
  }

  // ── Referensi desain via foto / forward ──────────────────────────────────────
  // ── Pertanyaan tentang foto/gambar yang dikirim customer ─────────────────────
  const tanyaFotoKeywords = [
    "di foto ini",
    "di gambar ini",
    "di foto tersebut",
    "di gambar tersebut",
    "foto ini bahan",
    "gambar ini bahan",
    "foto ini pakai",
    "gambar ini pakai",
    "foto tadi",
    "gambar tadi",
    "foto yang",
    "gambar yang",
    "ini bahan apa",
    "ini pakai bahan",
    "ini jersey apa",
    "ini tipe apa",
    "ini paket apa",
    "ini model apa",
    "ini jenis apa",
    "yg di foto",
    "yg di gambar",
    "yang di foto",
    "yang di gambar",
    "kalo di foto",
    "kalau di foto",
    "kalo di gambar",
    "kalau di gambar",
  ];
  if (tanyaFotoKeywords.some((k) => lower.includes(k))) {
    return {
      handled: true,
      reply: "Baik kak, nanti saya tanyakan ke admin ya 🙏",
    };
  }

  const referensiDesainKeywords = [
    "seperti ini bisa",
    "kayak gini bisa",
    "kayak ini bisa",
    "model seperti ini",
    "model kayak ini",
    "mau seperti ini",
    "mau kayak ini",
    "bisa seperti ini",
    "bisa kayak gini",
    "desain seperti ini",
    "desain kayak ini",
    "referensi ini",
    "contoh seperti ini",
    "mau yang seperti",
    "mau yang kayak",
    "bisa bikin seperti",
    "bisa bikin kayak",
    "mirip seperti ini",
    "mirip kayak ini",
    "seperti foto ini",
    "seperti gambar ini",
  ];
  if (referensiDesainKeywords.some((k) => lower.includes(k))) {
    return {
      handled: true,
      reply:
        "Baik kak, referensi desainnya sudah kami terima 😊\nNanti admin kami yang akan chat kembali untuk bantu proses selanjutnya ya 🙏",
    };
  }

  // ── Fallback gambar tidak tersedia + blacklist ───────────────────────────────
  // Fallback: user minta gambar/foto tetapi tidak terpetakan ke folder gambar yang ada
  const unknownImageRequestKeywords = [
    "kirim gambar",
    "kirim foto",
    "kirimkan gambar",
    "kirimkan foto",
    "minta gambar",
    "minta foto",
    "boleh minta gambar",
    "boleh minta foto",
    "share gambar",
    "share foto",
    "lihat gambar",
    "lihat foto",
    "contoh gambar",
    "contoh foto",
    "gambar jersey",
    "foto jersey",
  ];
  if (unknownImageRequestKeywords.some((k) => lower.includes(k))) {
    return {
      handled: true,
      reply: ADMIN_IMAGE_FOLLOWUP_REPLY,
    };
  }

  const blacklist = ["judi", "togel", "porn", "bokep", "scam"];
  if (blacklist.some((word) => lower.includes(word))) {
    return {
      handled: true,
      reply: "Maaf, saya tidak bisa membantu untuk hal tersebut.",
    };
  }

  return { handled: false };
}

module.exports = {
  handleCommand,
  clearKatalogState,
  clearPricelistJerseyState,
  setAwaitingBuktiTf,
  isAwaitingBuktiTf,
  clearAwaitingBuktiTf,
  setAwaitingTfForm,
  isAwaitingTfForm,
  clearAwaitingTfForm,
  setAwaitingRating,
  isAwaitingRating,
  clearAwaitingRating,
  BUKTI_TF_REPLY,
  CS_ORDER_JID,
  CS_SENIOR_JID,
  FINANCE_JID,
};
