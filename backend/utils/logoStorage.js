const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");

const UPLOADS_DIR = path.resolve(__dirname, "../uploads");
const PUBLIC_UPLOADS_DIR = path.resolve(__dirname, "../public/uploads");
const LOGO_FILENAME = "company_logo.png";
const LOCAL_LOGO_PATH = path.join(UPLOADS_DIR, LOGO_FILENAME);
const PUBLIC_LOGO_PATH = path.join(PUBLIC_UPLOADS_DIR, LOGO_FILENAME);

function ensureUploadDirs() {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
  if (!fs.existsSync(PUBLIC_UPLOADS_DIR)) {
    fs.mkdirSync(PUBLIC_UPLOADS_DIR, { recursive: true });
  }
}

function ensureDefaultLogoExists() {
  ensureUploadDirs();
  if (!fs.existsSync(LOCAL_LOGO_PATH)) {
    const frontendLogoPath = path.resolve(__dirname, "../../frontend/assets/images/logo.png");
    const frontendLogoPosPath = path.resolve(__dirname, "../../frontend/assets/images/logo_pos.png");
    
    if (fs.existsSync(frontendLogoPath)) {
      fs.copyFileSync(frontendLogoPath, LOCAL_LOGO_PATH);
      fs.copyFileSync(frontendLogoPath, PUBLIC_LOGO_PATH);
      console.log("✅ [LogoStorage] Default company logo copied from assets to backend uploads.");
    } else if (fs.existsSync(frontendLogoPosPath)) {
      fs.copyFileSync(frontendLogoPosPath, LOCAL_LOGO_PATH);
      fs.copyFileSync(frontendLogoPosPath, PUBLIC_LOGO_PATH);
      console.log("✅ [LogoStorage] Default logo_pos copied to backend uploads.");
    }
  } else if (!fs.existsSync(PUBLIC_LOGO_PATH)) {
    fs.copyFileSync(LOCAL_LOGO_PATH, PUBLIC_LOGO_PATH);
  }
  return "/uploads/company_logo.png";
}

async function saveLogoToDisk(logoDataOrUrl) {
  ensureUploadDirs();
  
  if (!logoDataOrUrl || typeof logoDataOrUrl !== "string" || logoDataOrUrl.trim() === "") {
    return ensureDefaultLogoExists();
  }

  const trimmed = logoDataOrUrl.trim();

  // If already relative uploads path, ensure file exists on disk
  if (trimmed.includes("/uploads/company_logo.png") || trimmed.includes("uploads/company_logo.png")) {
    ensureDefaultLogoExists();
    return "/uploads/company_logo.png";
  }

  // Handle Base64 strings
  if (trimmed.startsWith("data:image")) {
    try {
      const base64Data = trimmed.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");
      fs.writeFileSync(LOCAL_LOGO_PATH, buffer);
      fs.writeFileSync(PUBLIC_LOGO_PATH, buffer);
      console.log("✅ [LogoStorage] Base64 company logo saved locally to disk.");
      return "/uploads/company_logo.png";
    } catch (err) {
      console.error("⚠️ [LogoStorage] Base64 logo save error:", err.message);
    }
  }

  // Handle Remote HTTP/HTTPS URLs
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    if (trimmed.includes("localhost") || trimmed.includes("127.0.0.1")) {
      ensureDefaultLogoExists();
      return "/uploads/company_logo.png";
    }
    try {
      await downloadImage(trimmed, LOCAL_LOGO_PATH);
      if (fs.existsSync(LOCAL_LOGO_PATH)) {
        fs.copyFileSync(LOCAL_LOGO_PATH, PUBLIC_LOGO_PATH);
      }
      console.log("✅ [LogoStorage] Remote company logo downloaded and saved locally.");
      return "/uploads/company_logo.png";
    } catch (err) {
      console.error("⚠️ [LogoStorage] Error downloading remote logo:", err.message);
    }
  }

  return ensureDefaultLogoExists();
}

function downloadImage(url, dest) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    const req = client.get(url, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to download logo, HTTP status ${res.statusCode}`));
      }
      const fileStream = fs.createWriteStream(dest);
      res.pipe(fileStream);
      fileStream.on("finish", () => {
        fileStream.close(resolve);
      });
    });
    req.on("error", (err) => reject(err));
    req.setTimeout(8000, () => {
      req.destroy();
      reject(new Error("Image download timeout"));
    });
  });
}

module.exports = {
  ensureUploadDirs,
  ensureDefaultLogoExists,
  saveLogoToDisk,
  LOCAL_LOGO_PATH
};
