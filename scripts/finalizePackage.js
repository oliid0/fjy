const fs = require("fs/promises");
const path = require("path");
const { createRequire } = require("module");

const ts = require("typescript");

const root = path.resolve(__dirname, "../packages/fcboard/dist/types");
const modules = {
  "@fcboard/common": "common/src",
  "@fcboard/element": "element/src",
  "@fcboard/math": "math/src",
  "@fcboard/utils": "utils/src",
  "@fcboard/fcboard": "fcboard",
};

/** Anchor esbuild's emitted asset strings to their module. Consumer bundlers
 * can then emit fonts/images, instead of requesting them from the app's root.
 */
async function binaryURLs(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await binaryURLs(file);
      continue;
    }
    if (!entry.name.endsWith(".js")) {
      continue;
    }
    const source = await fs.readFile(file, "utf8");
    const parsed = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    );
    const replacements = [];
    function inspect(node) {
      if (
        ts.isStringLiteral(node) &&
        node.text.startsWith(".") &&
        /\.(woff2?|ttf|otf|png|jpe?g|gif|svg|webp|wasm)$/.test(node.text) &&
        !(
          ts.isNewExpression(node.parent) &&
          node.parent.expression.getText(parsed) === "URL"
        )
      ) {
        replacements.push({
          start: node.getStart(parsed),
          end: node.getEnd(),
          value: node.text,
        });
      }
      ts.forEachChild(node, inspect);
    }
    inspect(parsed);
    let content = source;
    for (const change of replacements.reverse()) {
      try {
        if (
          !(
            await fs.stat(path.resolve(path.dirname(file), change.value))
          ).isFile()
        ) {
          continue;
        }
      } catch (error) {
        if (error.code === "ENOENT") {
          continue;
        }
        throw error;
      }
      content = `${content.slice(0, change.start)}new URL(${JSON.stringify(
        change.value,
      )}, import.meta.url).href${content.slice(change.end)}`;
    }
    const stylesheet = entry.name.replace(/\.js$/, ".css");
    try {
      if (
        (await fs.stat(path.join(directory, stylesheet))).isFile() &&
        !content.includes(`import "./${stylesheet}";`)
      ) {
        content = `import "./${stylesheet}";\n${content}`;
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
    if (content !== source) {
      await fs.writeFile(file, content);
    }
  }
}

/** tsc emits the complete declaration graph but preserves source aliases.
 * Resolve only our five workspace specifiers to declarations inside this package.
 */
async function finalize(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await finalize(file);
    } else if (entry.name.endsWith(".d.ts")) {
      const original = await fs.readFile(file, "utf8");
      const content = original.replace(
        /(["'])(@fcboard\/(?:common|element|math|utils|fcboard))((?:\/[^"']*)?)\1/g,
        (match, quote, module, suffix) => {
          const target = path.join(
            root,
            modules[module],
            suffix ? suffix.slice(1) : "index",
          );
          let relative = path
            .relative(path.dirname(file), target)
            .split(path.sep)
            .join("/");
          if (!relative.startsWith(".")) {
            relative = `./${relative}`;
          }
          return `${quote}${relative}${quote}`;
        },
      );
      const bundled = content.replace(
        /(["'])(jotai-scope|@excalidraw\/mermaid-to-excalidraw(?:\/dist\/interfaces)?)\1/g,
        (match, quote, module) => {
          let relative = path
            .relative(
              path.dirname(file),
              path.join(
                root,
                "vendor",
                module === "jotai-scope" ? "jotai-scope" : "mermaid",
              ),
            )
            .split(path.sep)
            .join("/");
          if (!relative.startsWith(".")) {
            relative = `./${relative}`;
          }
          return `${quote}${relative}${quote}`;
        },
      );
      if (bundled !== original) {
        await fs.writeFile(file, bundled);
      }
    }
  }
}

async function preparePackage() {
  const source = path.resolve(__dirname, "../packages/fcboard");
  const requireFromSDK = createRequire(path.join(source, "package.json"));
  const vendor = path.join(root, "vendor");
  await fs.mkdir(vendor, { recursive: true });
  const jotai = path.dirname(
    requireFromSDK.resolve("jotai-scope/package.json"),
  );
  await fs.copyFile(
    path.join(jotai, "dist/src/createIsolation.d.ts"),
    path.join(vendor, "jotai-scope.d.ts"),
  );
  const mermaid = path.dirname(
    requireFromSDK.resolve("@excalidraw/mermaid-to-excalidraw"),
  );
  const declarations = [];
  for (const [file, name] of [
    ["index.d.ts", "MermaidConfig"],
    ["interfaces.d.ts", "MermaidToExcalidrawResult"],
  ]) {
    const input = await fs.readFile(path.join(mermaid, file), "utf8");
    const parsed = ts.createSourceFile(
      file,
      input,
      ts.ScriptTarget.Latest,
      true,
    );
    const declaration = parsed.statements.find(
      (node) => ts.isInterfaceDeclaration(node) && node.name.text === name,
    );
    if (!declaration) {
      throw new Error(`Missing installed Mermaid declaration: ${name}`);
    }
    declarations.push(declaration.getFullText(parsed));
  }
  await fs.writeFile(
    path.join(vendor, "mermaid.d.ts"),
    `import type { FcboardElementSkeleton as ExcalidrawElementSkeleton } from "../element/src/transform";\nimport type { BinaryFiles } from "../fcboard/types";\n${declarations.join(
      "\n",
    )}`,
  );
  for (const [directory, name] of [
    [jotai, "jotai-scope"],
    [path.dirname(mermaid), "mermaid"],
  ]) {
    const license = (await fs.readdir(directory)).find((file) =>
      /^license(?:\.|$)/i.test(file),
    );
    if (!license) {
      throw new Error(`Missing dependency license: ${name}`);
    }
    await fs.copyFile(
      path.join(directory, license),
      path.join(vendor, `${name}.LICENSE`),
    );
  }
  const pkg = JSON.parse(
    await fs.readFile(path.join(source, "package.json"), "utf8"),
  );
  const output = path.join(source, "dist/npm");
  for (const mode of ["dev", "prod"]) {
    await binaryURLs(path.join(source, "dist", mode));
  }
  for (const name of ["common", "element", "math", "utils", "fcboard"]) {
    const directory = path.resolve(source, "..", name);
    const target = path.join(root, name);
    await fs.mkdir(target, { recursive: true });
    for (const file of await fs.readdir(directory)) {
      if (file.endsWith(".d.ts")) {
        await fs.copyFile(path.join(directory, file), path.join(target, file));
        const definition = path.join(target, file);
        const content = await fs.readFile(definition, "utf8");
        await fs.writeFile(
          definition,
          content.replace(
            /^\/\/\/ <reference types="vite\/client" \/>\r?\n/gm,
            "",
          ),
        );
      }
    }
  }
  await finalize(root);
  await fs.cp(
    path.join(source, "locales"),
    path.join(root, "fcboard/locales"),
    { recursive: true },
  );
  await fs.rm(output, { recursive: true, force: true });
  await fs.mkdir(path.join(output, "dist"), { recursive: true });
  for (const directory of ["dev", "prod", "types"]) {
    await fs.cp(
      path.join(source, "dist", directory),
      path.join(output, "dist", directory),
      { recursive: true },
    );
  }
  await fs.mkdir(path.join(output, "dist/assets"), { recursive: true });
  await fs.copyFile(
    path.join(source, "components/FactoryEraser.png"),
    path.join(output, "dist/assets/FactoryEraser.png"),
  );
  for (const file of ["README.md", "LICENSE"]) {
    await fs.copyFile(
      path.resolve(__dirname, "../docs/npm", file),
      path.join(output, file),
    );
  }
  delete pkg.private;
  delete pkg.scripts;
  delete pkg.devDependencies;
  pkg.name = "fcboard";
  for (const name of Object.keys(pkg.dependencies)) {
    let directory = source;
    while (directory !== path.dirname(directory)) {
      const metadata = path.join(
        directory,
        "node_modules",
        name,
        "package.json",
      );
      try {
        const installed = JSON.parse(await fs.readFile(metadata, "utf8"));
        pkg.dependencies[name] = installed.version;
        break;
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }
      directory = path.dirname(directory);
    }
  }
  for (const name of ["common", "element", "math", "utils"]) {
    const types = pkg.exports[`./${name}`].types;
    const wildcardTypes = pkg.exports[`./${name}/*`].types;
    pkg.exports[`./${name}`] = {
      types,
      development: `./dist/dev/${name}/index.js`,
      production: `./dist/prod/${name}/index.js`,
      default: `./dist/prod/${name}/index.js`,
    };
    pkg.exports[`./${name}/*`] = {
      types: wildcardTypes,
      development: `./dist/dev/${name}/*.js`,
      production: `./dist/prod/${name}/*.js`,
      default: `./dist/prod/${name}/*.js`,
    };
  }
  delete pkg.exports["./*"];
  pkg.exports["./types"] = { types: "./dist/types/fcboard/types.d.ts" };
  pkg.exports["./editor/*"] = {
    types: "./dist/types/fcboard/*.d.ts",
    development: "./dist/dev/editor/*.js",
    production: "./dist/prod/editor/*.js",
    default: "./dist/prod/editor/*.js",
  };
  pkg.exports["./locales/*"] = "./dist/types/fcboard/locales/*";
  pkg.exports["./assets/*"] = "./dist/assets/*";
  pkg.exports["./package.json"] = "./package.json";
  async function directoryExports(directory, prefix) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        await directoryExports(
          path.join(directory, entry.name),
          `${prefix}/${entry.name}`,
        );
      } else if (entry.name === "index.js") {
        const [group, ...rest] = prefix.split("/");
        const typesDirectory = group === "editor" ? "fcboard" : `${group}/src`;
        pkg.exports[`./${prefix}`] = {
          types: `./dist/types/${typesDirectory}/${
            rest.length ? `${rest.join("/")}/` : ""
          }index.d.ts`,
          development: `./dist/dev/${prefix}/index.js`,
          production: `./dist/prod/${prefix}/index.js`,
          default: `./dist/prod/${prefix}/index.js`,
        };
      }
    }
  }
  for (const name of ["editor", "common", "element", "math", "utils"]) {
    await directoryExports(path.join(source, "dist/dev", name), name);
  }
  await fs.writeFile(
    path.join(output, "package.json"),
    `${JSON.stringify(pkg, null, 2)}\n`,
  );
  console.info(`Publishable ${pkg.name}@${pkg.version}: ${output}`);
}

preparePackage().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
