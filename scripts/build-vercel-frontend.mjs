import { spawn } from "node:child_process";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const argumentsList = process.argv.slice(2);
const outputNameArgumentIndex = argumentsList.indexOf("--test-output-name");
const outputName =
  outputNameArgumentIndex === -1
    ? "output"
    : argumentsList[outputNameArgumentIndex + 1];
const expectedArguments =
  outputNameArgumentIndex === -1
    ? []
    : ["--test-output-name", outputName];
if (
  !outputName ||
  argumentsList.length !== expectedArguments.length ||
  !argumentsList.every((value, index) => value === expectedArguments[index]) ||
  (outputName !== "output" && !/^test-output-[A-Za-z0-9_-]+$/.test(outputName))
) {
  throw new Error(
    "Only --test-output-name test-output-<id> is accepted; output remains inside .vercel/.",
  );
}
const outputDirectory = resolve(
  fileURLToPath(new URL(`../.vercel/${outputName}`, import.meta.url)),
);

function publicApiOrigin(value) {
  if (!value) {
    throw new Error(
      "LOUPE_API_ORIGIN is required (for example, https://api.loupe.example).",
    );
  }
  const url = new URL(value);
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new Error(
      "LOUPE_API_ORIGIN must be an HTTPS origin (loopback HTTP is allowed for local validation).",
    );
  }
  return url.origin;
}

function command(executable, args) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(executable, args, { cwd: root, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolveCommand();
      else reject(new Error(`${executable} ${args.join(" ")} exited ${code}.`));
    });
  });
}

const apiOrigin = publicApiOrigin(process.env.LOUPE_API_ORIGIN);
const configuration = {
  version: 3,
  routes: [
    { src: "^/api/(.*)$", dest: `${apiOrigin}/api/$1` },
    { handle: "filesystem" },
    { src: "^/.*$", dest: "/index.html" },
  ],
};

await command("pnpm", ["--filter", "@workspace/contracts", "build"]);
await command("pnpm", ["--filter", "@workspace/web", "build"]);

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
const staticDirectory = resolve(outputDirectory, "static");
await mkdir(staticDirectory, { recursive: true });
await cp(new URL("../apps/web/dist", import.meta.url), staticDirectory, {
  recursive: true,
});
await writeFile(
  resolve(outputDirectory, "config.json"),
  `${JSON.stringify(configuration, null, 2)}\n`,
  "utf8",
);
