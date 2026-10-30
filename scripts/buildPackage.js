const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");

const { build } = require("esbuild");
const { sassPlugin } = require("esbuild-sass-plugin");

const pkg = require("../packages/fcboard/package.json");

const ENV_VARS = {
  development: {
    PKG_NAME: "fcboard",
    PKG_VERSION: pkg.version,
    DEV: true,
    MODE: "development",
  },
  production: {
    PKG_NAME: "fcboard",
    PKG_VERSION: pkg.version,
    PROD: true,
    MODE: "production",
  },
};

// Resolve a relative path from the source file's directory
const resolveRelativePath = (importPath, sourceFile) => {
  const sourceDir = path.dirname(sourceFile);
  const extensions = [".scss", ".css", ""];

  for (const ext of extensions) {
    const fullPath = path.resolve(sourceDir, importPath + ext);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
    // Try with underscore prefix for partials
    const partialPath = path.join(
      path.dirname(fullPath),
      `_${path.basename(fullPath)}`,
    );
    if (fs.existsSync(partialPath)) {
      return partialPath;
    }
  }
  return null;
};

// Precompile function to convert relative paths to absolute paths
const precompile = (source, sourcePath) => {
  // Match @use and @forward statements with relative paths
  const importRegex = /(@use|@forward)\s+["'](\.[^"']+)["']/g;

  return source.replace(importRegex, (match, directive, importPath) => {
    const resolvedPath = resolveRelativePath(importPath, sourcePath);
    if (resolvedPath) {
      // Convert to file:// URL format for sass
      const fileUrl = pathToFileURL(resolvedPath).href;
      return `${directive} "${fileUrl}"`;
    }
    return match;
  });
};

// excludes all external dependencies and bundles only the source code
const getConfig = (outdir) => ({
  outdir,
  bundle: true,
  splitting: true,
  format: "esm",
  packages: "external",
  define: { "process.env.NODE_ENV": "process.env.NODE_ENV" },
  plugins: [
    {
      name: "fcboard-asset-queries",
      setup(context) {
        context.onResolve({ filter: /\?(raw|url)$/ }, (args) => ({
          path: path.relative(
            __dirname,
            path.resolve(
              args.resolveDir,
              args.path.replace(/\?(raw|url)$/, ""),
            ),
          ),
          namespace: args.path.endsWith("?raw")
            ? "fcboard-raw"
            : "fcboard-asset",
        }));
        context.onLoad(
          { filter: /.*/, namespace: "fcboard-raw" },
          async (args) => ({
            contents: await fs.promises.readFile(
              path.resolve(__dirname, args.path),
              "utf8",
            ),
            loader: "text",
          }),
        );
        context.onLoad(
          { filter: /.*/, namespace: "fcboard-asset" },
          async (args) => ({
            contents: await fs.promises.readFile(
              path.resolve(__dirname, args.path),
            ),
            loader: "file",
          }),
        );
      },
    },
    sassPlugin({
      precompile,
    }),
  ],
  target: "es2020",
  assetNames: "[dir]/[name]",
  chunkNames: "[dir]/[name]-[hash]",
  alias: {
    "@fcboard/common": path.resolve(__dirname, "../packages/common/src"),
    "@fcboard/element": path.resolve(__dirname, "../packages/element/src"),
    "@fcboard/math": path.resolve(__dirname, "../packages/math/src"),
    "@fcboard/fcboard": path.resolve(__dirname, "../packages/fcboard"),
    "@fcboard/utils": path.resolve(__dirname, "../packages/utils/src"),
    roughjs: path.dirname(require.resolve("roughjs/package.json")),
  },
  loader: {
    ".woff2": "file",
    ".ttf": "file",
    ".png": "file",
    ".svg": "file",
    ".jpg": "file",
    ".webp": "file",
    ".wasm": "file",
  },
});

function buildDev(config) {
  return build({
    ...config,
    sourcemap: false,
    define: {
      "process.env.NODE_ENV": "process.env.NODE_ENV",
      "import.meta.env": JSON.stringify(ENV_VARS.development),
    },
  });
}

function buildProd(config) {
  return build({
    ...config,
    minify: true,
    define: {
      "process.env.NODE_ENV": "process.env.NODE_ENV",
      "import.meta.env": JSON.stringify(ENV_VARS.production),
    },
  });
}

const createESMRawBuild = async () => {
  const entryPoints = [];
  const entries = (directory, prefix) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (
        [
          "node_modules",
          "dist",
          "tests",
          "__tests__",
          "examples",
          "test-utils.ts",
        ].includes(entry.name)
      ) {
        continue;
      }
      const source = path.join(directory, entry.name);
      const output = path.posix.join(prefix, entry.name);
      if (entry.isDirectory()) {
        entries(source, output);
      } else if (
        /\.tsx?$/.test(entry.name) &&
        !/\.d\.ts$|\.(test|spec)\./.test(entry.name)
      ) {
        entryPoints.push({ in: source, out: output.replace(/\.tsx?$/, "") });
      }
    }
  };
  entries(process.cwd(), "editor");
  for (const name of ["common", "element", "math", "utils"]) {
    entries(path.resolve("..", name, "src"), name);
  }
  entryPoints.push({ in: "index.tsx", out: "index" });
  const chunksConfig = {
    entryPoints,
    entryNames: "[dir]/[name]",
  };

  // development unminified build with source maps
  await buildDev({
    ...getConfig("dist/dev"),
    ...chunksConfig,
  });

  // production minified buld without sourcemaps
  await buildProd({
    ...getConfig("dist/prod"),
    ...chunksConfig,
  });
};

(async () => {
  await createESMRawBuild();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
