# Revisi Chatbot — Catatan Meeting

**Jadwal meeting:** Senin, 25 Mei 2026, 08:30 WIB
**Sumber catatan:** Pesan dari pemilik/owner (bsk pagi jam 08.30)
**Status:** Menunggu instruksi lanjut sebelum eksekusi

---

## Daftar Revisi (13 item)

### 1. Greeting diganti dengan bahasa yang umum
- **Kondisi sekarang:** Greeting masih kaku — langsung perkenalan formal "Perkenalkan, saya Nadia, AI asisten CS..."
- **Lokasi kode:** `src/handlers/commandHandler.js:363-369` (greeting blok) + `src/ai/prompt.js:29,40` (perkenalan rule)
- **Rencana revisi:** Pakai sapaan casual "Halo kak! 👋 Ada yang bisa Nadia bantu hari ini?" — tidak langsung kasih perkenalan panjang di first reply, baru kasih konteks "Nadia" kalau customer tanya.
- **Status:** Bisa langsung dieksekusi via prompt + commandHandler update.

### 2. Selalu akhiri chat dengan pertanyaan
- **Kondisi sekarang:** AI sering closing tanpa pertanyaan ("Terima kasih ya kak 🙏"). Ini bikin conversation flow berhenti.
- **Lokasi kode:** `src/ai/prompt.js` — rule baru di system prompt.
- **Rencana revisi:** Tambah rule WAJIB di prompt: setiap balasan AI harus diakhiri dengan satu pertanyaan terbuka untuk lanjutkan obrolan, kecuali saat customer eksplisit bilang sudah selesai / terima kasih sebagai penutup.
- **Status:** Bisa langsung dieksekusi via prompt update.

### 3. Jawaban harus lebih tertarget + diakhiri pertanyaan spesifik
- **Contoh dari owner:** "Apakah bisa bantu design?" → "Bisa sekali kak, apakah sudah ada referensi design dari kakak?"
- **Lokasi kode:** `src/ai/prompt.js` — pattern instruction.
- **Rencana revisi:** Tambah few-shot examples di prompt biar AI selalu confirm + tanya balik dengan pertanyaan yang menggali kebutuhan (referensi design, ukuran kaos, tema warna, dll).
- **Status:** Bisa via prompt update (1 file).

### 4. Belum paham terkait ongkir
- **Kondisi sekarang:** `data.md:137` cuma "tergantung alamat pengiriman" — terlalu dangkal, AI ga punya bahan buat jawab detail.
- **Action item ke tim ops/produksi:**
  - Range biaya ongkir per zona (Jabodetabek, Jawa, luar Jawa)?
  - Apakah free ongkir di atas qty/nominal tertentu?
  - Apakah ongkir di-handle customer atau Ayres?
  - Estimasi waktu kirim per ekspedisi (JNE / JNT / Lion)?
- **Status:** ⚠️ Blocked — butuh input data dari tim ops sebelum di-update ke knowledge base.

### 5. Belum paham terkait deadline lock
- **Kondisi sekarang:** Tidak ada di `data.md` maupun di prompt. AI tidak punya konsep ini.
- **Action item ke owner/admin:**
  - Apa definisi "deadline lock"? (kemungkinan: tanggal commit produksi setelah customer setuju desain?)
  - Kapan deadline lock di-set? Setelah DP desain, atau setelah ACC proofing?
  - Apa konsekuensi kalau customer minta perubahan setelah lock?
- **Status:** ⚠️ Blocked — butuh klarifikasi definisi.

### 6. Belum paham terkait pattern lab
- **Kondisi sekarang:** Disebut sekilas di `data.md:70` ("ditawarkan pattern lab") — tidak ada penjelasan apa, list pattern apa saja, atau gambarnya.
- **Action item ke tim desain:**
  - Apa itu pattern lab? (kemungkinan: katalog pola/motif jersey siap pakai?)
  - List pattern yang tersedia + gambar tiap pattern.
  - Apakah ada biaya tambahan untuk pakai pattern lab?
- **Status:** ⚠️ Blocked — butuh data + gambar dari tim desain.

### 7. Apabila customer tidak mau dikenain biaya ekspress?
- **Kondisi sekarang:** AI menjelaskan opsi ekspress tapi tidak ada flow handling kalau customer menolak.
- **Rencana revisi:** Tambah rule di prompt: kalau customer tolak ekspress, konfirmasi pakai estimasi normal (21 hari kerja dari ACC proofing) dan tanya apakah deadline tersebut masih sesuai dengan kebutuhan customer.
- **Status:** Bisa langsung via prompt update.

### 8. Customer nego harga / order banyak — apakah ada minimal?
- **Kondisi sekarang:** `data.md:44` minimum 6 pcs tanpa biaya tambahan. Diskon grosir cuma disebut "biasanya lebih ekonomis" — tidak ada tier/persentase.
- **Action item ke owner/sales:**
  - Tier qty + harga (misal: 6-20 pcs harga A, 21-50 pcs harga B, 50+ pcs nego)?
  - Diskon minimum berapa qty? Persentase berapa?
  - Apakah AI boleh quote diskon, atau wajib escalate ke admin?
- **Status:** ⚠️ Blocked — butuh price-tier matrix.

### 9. Customer minta info kaos kaki gratis — bot bilang "konfirmasi ke admin dulu". Bot bisa follow up otomatis?
- **Kondisi sekarang:** Bot Baileys hanya respon ke inbound. Tidak ada cron / queue follow-up otomatis.
- **Limitasi teknis:** Bot tidak bisa "ingat" untuk balas balik ke customer setelah admin update jawaban. Butuh sistem ticketing + manual trigger dari admin.
- **Rencana revisi (short-term):** Bot tetap arahkan ke admin, JANGAN janji follow up otomatis. Tambahkan log internal "pending admin" supaya admin tahu ada customer menunggu.
- **Rencana revisi (long-term):** Bangun sistem ticketing — admin kasih jawaban via dashboard, sistem trigger bot kirim ke customer. Butuh DB + admin panel.
- **Status:** Short-term bisa, long-term butuh scope kerja terpisah.

### 10. Customer bilang "sudah TF" — apakah chatbot konfirmasi ke CS order & finance?
- **Kondisi sekarang:** Sudah ada flow di `src/handlers/commandHandler.js:69` (`BUKTI_TF_REPLY`) — bot balas customer minta kirim bukti ke finance manual. Bot TIDAK auto-notify ke CS order / finance.
- **Limitasi teknis:** Bot hanya balas customer. Untuk notify finance/CS internal butuh integrasi (Telegram group, email, atau internal WA group).
- **Rencana revisi:** Tambah fitur kirim notif ke nomor admin / Telegram group internal saat customer konfirmasi TF. Butuh setting nomor admin di env + sock.sendMessage ke nomor admin.
- **Status:** Bisa dieksekusi — butuh 1 fitur baru (notify admin).

### 11. Saat customer mengakhiri chat, AI minta data follow-up (nama, dll)
- **Kondisi sekarang:** Tidak ada flow capture data customer di akhir chat.
- **Rencana revisi:** Tambah rule di prompt: saat customer bilang "terima kasih", "udah dulu", "lain kali", AI minta nama + nomor kontak / domisili supaya admin bisa follow up nanti. Data dicatat ke log/file.
- **Lokasi kode:** `src/ai/prompt.js` (rule baru) + `src/utils/logger.js` atau buat file `data/leads.json`.
- **Status:** Bisa dieksekusi — butuh prompt update + simple file append untuk capture lead.

### 12. AI minta tanggapan / penilaian pelayanan CS (rating)
- **Kondisi sekarang:** Tidak ada fitur rating.
- **Rencana revisi:** Setelah chat selesai (customer pamit), AI minta rating 1-5 + komentar singkat. Hasil disimpan ke file/log untuk evaluasi.
- **Lokasi kode:** `src/handlers/commandHandler.js` (state ratingPending) + log file.
- **Status:** Bisa dieksekusi — fitur baru sederhana.

### 13. AI berikan urgency message agar customer segera order
- **Contoh dari owner:** "Order hari ini free desain + free print nama, cukup DP 20% untuk lock harga promo. Slot produksi tinggal 5 tim."
- **Pertanyaan:** Apakah promo ini selalu aktif atau tergantung kondisi? Kalau dynamic, perlu mekanisme toggle/admin set.
- **Rencana revisi:** Tambah pesan urgency di akhir penawaran DP (Langkah 1 ALUR DP DESAIN). Bisa pakai env var `PROMO_ACTIVE=true` + `PROMO_MESSAGE="..."` supaya bisa di-toggle dari Railway tanpa redeploy.
- **Status:** Bisa dieksekusi — butuh konfirmasi promo content dari owner.

---

## Ringkasan Action Items

### Bisa langsung dieksekusi (no blocker)
| # | Item | File yang diubah |
|---|------|------------------|
| 1 | Greeting casual | `commandHandler.js`, `prompt.js` |
| 2 | Akhiri chat dengan pertanyaan | `prompt.js` |
| 3 | Jawaban tertarget + tanya balik | `prompt.js` |
| 7 | Handling tolak ekspress | `prompt.js` |
| 11 | Capture data follow-up | `prompt.js` + log |
| 12 | Rating CS | `commandHandler.js` + log |
| 13 | Urgency promo (pending content) | `prompt.js` + env |

### Butuh data dari tim sebelum eksekusi
| # | Item | Owner |
|---|------|-------|
| 4 | Detail ongkir | Tim ops/produksi |
| 5 | Definisi deadline lock | Owner / admin produksi |
| 6 | Pattern lab | Tim desain |
| 8 | Tier diskon grosir | Owner / sales |

### Butuh fitur baru
| # | Item | Scope |
|---|------|-------|
| 9 | Follow-up otomatis kaos kaki gratis | Sistem ticketing (long-term) |
| 10 | Notify finance/CS internal saat TF | 1 fitur baru — notify admin |

---

## Pertanyaan untuk Owner di Meeting

1. Detail ongkir — tim ops bisa kasih SOP harga + zona?
2. Definisi "deadline lock" — apakah ini sudah ada SOP, atau perlu di-define dulu?
3. Pattern lab — boleh minta file/gambar list pattern + harga tambahan kalau ada?
4. Tier harga grosir — bisa kasih matrix qty × harga atau persentase diskon?
5. Promo urgency (item 13) — apakah selalu aktif atau dinamis? Apakah "slot produksi tinggal 5 tim" beneran atau sales pitch?
6. Notify TF (item 10) — mau dikirim ke nomor admin pribadi, atau ke group internal Telegram/WA?
7. Rating CS (item 12) — disimpan di mana? File log saja, atau perlu dashboard?
8. Lead capture (item 11) — wajib data apa saja? Nama + nomor + asal kota / instansi?
