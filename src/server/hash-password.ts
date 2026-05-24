import { hashAppPassword } from "./config";

const password = process.argv[2] ?? process.env.APP_PASSWORD ?? "";

if (!password.trim()) {
  console.error("Usage: bun run hash:password -- <password>");
  console.error("You can also set APP_PASSWORD and run: bun run hash:password");
  process.exit(1);
}

console.log(`APP_PASSWORD_HASH=${hashAppPassword(password)}`);
