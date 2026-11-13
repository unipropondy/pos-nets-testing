// Safe pure-JS shim for sunmi-printer-expo
// Returns non-fatal responses so non-Sunmi phones and other devices never crash

const initPrinter = async () => false;
const printText = async () => {};
const printTextWithSize = async () => {};
const lineWrap = async () => {};
const cutPaper = async () => {};
const printBarcode = async () => {};
const printQRCode = async () => {};
const printImage = async () => {};
const printImageBase64 = async () => {};

const sunmi = {
  initPrinter,
  printText,
  printTextWithSize,
  lineWrap,
  cutPaper,
  printBarcode,
  printQRCode,
  printImage,
  printImageBase64,
};

module.exports = sunmi;
module.exports.default = sunmi;
module.exports.initPrinter = initPrinter;
module.exports.printText = printText;
module.exports.printTextWithSize = printTextWithSize;
module.exports.lineWrap = lineWrap;
module.exports.cutPaper = cutPaper;
module.exports.printBarcode = printBarcode;
module.exports.printQRCode = printQRCode;
module.exports.printImage = printImage;
module.exports.printImageBase64 = printImageBase64;
