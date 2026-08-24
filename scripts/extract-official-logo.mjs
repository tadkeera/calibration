import { execFileSync } from "node:child_process";

const source = "/home/ubuntu/webdev-static-assets/yemen-qc-official-report-header.png";
const target = "/home/ubuntu/webdev-static-assets/yemen-qc-official-header-logo.png";

execFileSync("python3", ["-c", `
from PIL import Image
source = Image.open(${JSON.stringify(source)}).convert("RGBA")
# The official Board logo occupies the central cell of the approved header.
logo = source.crop((362, 13, 450, 144))
logo.save(${JSON.stringify(target)})
`], { stdio: "inherit" });

console.log(target);
