import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  readFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  root = path.resolve(app, "../..");
const sdk =
  process.env.ANDROID_SDK_ROOT ??
  process.env.ANDROID_HOME ??
  path.join(root, ".tools/android-sdk");
if (!existsSync(path.join(sdk, "platforms/android-36")))
  throw new Error("需要Android SDK 36，请设置ANDROID_SDK_ROOT");
const java =
  process.env.JAVA_HOME ?? path.join(root, ".tools/jdk21/Contents/Home");
const env = {
  ...process.env,
  JAVA_HOME: java,
  ANDROID_HOME: sdk,
  GRADLE_USER_HOME:
    process.env.GRADLE_USER_HOME ?? path.join(root, ".tools/gradle"),
};
execFileSync("npm", ["run", "sync"], { cwd: app, env, stdio: "inherit" });
writeFileSync(path.join(app, "android/local.properties"), `sdk.dir=${sdk}\n`);
execFileSync(
  path.join(app, "android/gradlew"),
  [":app:assembleDebug", "--console=plain"],
  { cwd: path.join(app, "android"), env, stdio: "inherit" },
);
const target = path.join(
  root,
  "artifacts/android/TradeOS-offline-prototype-0.1.0.apk",
);
mkdirSync(path.dirname(target), { recursive: true });
copyFileSync(
  path.join(app, "android/app/build/outputs/apk/debug/app-debug.apk"),
  target,
);
writeFileSync(
  target + ".sha256",
  createHash("sha256").update(readFileSync(target)).digest("hex") + "\n",
);
console.log(`已生成离线验证安装包：${target}`);
