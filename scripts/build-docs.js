import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const publicDir = path.join(root, "public");
const docsDir = path.join(root, "docs");

if (!fs.existsSync(publicDir)) {
  console.error("public/ not found");
  process.exit(1);
}

fs.rmSync(docsDir, { recursive: true, force: true });
fs.mkdirSync(docsDir, { recursive: true });

copyDir(publicDir, docsDir);
fs.writeFileSync(path.join(docsDir, ".nojekyll"), "");
console.log("docs/ updated from public/");

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
