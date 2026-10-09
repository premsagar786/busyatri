import "dotenv/config";
import { makeToken, hashToken } from "./tokens";
import { rotateBusToken } from "../db/store";

const bus = process.argv[2];
if (!bus) {
  console.error("usage: npm run gen-token -- BUS\\ 01");
  process.exit(1);
}
async function main() {
  const token = makeToken();
  const ok = await rotateBusToken(bus, hashToken(token));
  if (!ok) {
    console.error(`bus ${bus} not found`);
    process.exit(1);
  }
  console.log(`new token for ${bus}: ${token}`);
}
main().catch((err) => { console.error(err); process.exit(1); });
