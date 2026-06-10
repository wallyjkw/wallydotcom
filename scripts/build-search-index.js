// Builds public/recipes/search-index.json by scanning every recipe page.
// Each entry: { slug, name, text } where `text` is the lowercased, tag-stripped
// content (ingredients + steps + notes) used for the search box on /recipes.
//
// Run it whenever recipes are added or edited:   node scripts/build-search-index.js

const fs = require("fs");
const path = require("path");

const RECIPES_DIR = path.join(__dirname, "..", "public", "recipes");
const OUT_FILE = path.join(RECIPES_DIR, "search-index.json");

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function stripTags(html) {
  return decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

const files = fs
  .readdirSync(RECIPES_DIR)
  .filter((f) => f.endsWith(".html"));

const index = [];

for (const file of files) {
  const slug = file.replace(/\.html$/, "");
  const html = fs.readFileSync(path.join(RECIPES_DIR, file), "utf8");

  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const main = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  if (!h1 || !main) {
    console.warn(`Skipped ${file} (no <h1> or <main>)`);
    continue;
  }

  const name = stripTags(h1[1]);

  // Drop the wordmark + backlink so they don't pollute search text.
  const body = main[1]
    .replace(/<a class="backlink"[\s\S]*?<\/a>/i, " ")
    .replace(/<div class="wordmark"[\s\S]*?<\/div>/i, " ");

  index.push({ slug, name, text: stripTags(body).toLowerCase() });
}

index.sort((a, b) => a.name.localeCompare(b.name));

fs.writeFileSync(OUT_FILE, JSON.stringify(index) + "\n", "utf8");
console.log(`Wrote ${index.length} recipes to ${path.relative(process.cwd(), OUT_FILE)}`);
