#!/usr/bin/env node
"use strict";

const esbuild = require("esbuild");
const fs      = require("fs");
const watch   = process.argv.includes("--watch");

const pkg = JSON.parse(fs.readFileSync("./package.json", "utf8"));

const opts = {
  entryPoints: ["src/main.js"],
  bundle: true,
  outfile: "team-dashboard.bundle.js",
  platform: "browser",
  format: "iife",
  globalName: "TeamDashboard",
  sourcemap: true,
  minify: false,
  logLevel: "info",
  define: {
    PACKAGE_VERSION: JSON.stringify(pkg.version),
  },
};

if (watch) {
  esbuild.context(opts).then(ctx => {
    ctx.watch();
    console.log("[build] watching src/ for changes…");
  });
} else {
  esbuild.build(opts).then(() => {
    console.log("[build] team-dashboard.bundle.js written");
  }).catch(() => process.exit(1));
}
