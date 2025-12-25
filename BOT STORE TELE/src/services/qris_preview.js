import QRCode from "qrcode";

export async function makeQrisPngBuffer(qrString) {
  // qrString harus payload QRIS (bukan URL)
  return QRCode.toBuffer(qrString, {
    type: "image/png",
    errorCorrectionLevel: "M",
    margin: 1,
    scale: 8,
  });
}
