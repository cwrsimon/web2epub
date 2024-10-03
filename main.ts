import * as path from "jsr:@std/path";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { stringify } from "jsr:@std/yaml";

type ParseResult = {
  title: string;
  content: string;
  textContent: string;
  length: number;
  excerpt: string;
  byline: string;
  dir: string;
  siteName: string;
  lang: string;
  publishedTime: string;
};

const EXTRACTED_HTML_FILENAME = "extracted.html";
const RAW_HTML_FILENAME = "document-raw.html";

export function extractDocId(url: string): string {
  const parseResult = URL.parse(url);
  if (parseResult == null) {
    throw new Error("Unable to parse incoming url.");
  }
  const candidate = parseResult.pathname.split("/").reverse()[0];
  return candidate.replaceAll("\\s", "_").replaceAll("/", "_").replaceAll(
    "\\?",
    "",
  ).replaceAll(":", "");
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) {
      throw err;
    }
    return false;
  }
}

async function createDir(dirname: string): Promise<boolean> {
  try {
    await Deno.mkdir(dirname);
    return true;
  } catch (err) {
    if (!(err instanceof Deno.errors.AlreadyExists)) {
      throw err;
    }
    return false;
  }
}

//async function generateMetadata(worddir)

async function generateEpub(workdir: string, docId: string): Promise<boolean> {
  const cmd = new Deno.Command("pandoc", {
    args: [
      "-f",
      "html",
      "-t",
      "epub2",
      path.join(workdir, EXTRACTED_HTML_FILENAME),
      //"--metadata", "title=" + title, // + " subtitle=My Description",
      // TODO
      "--metadata-file",
      path.join(workdir, "metadata.yaml"),

      // "mymetadata.yaml",
      "--epub-title-page=false",
      "--css=static/eink-optimized.css",
      "-o",
      path.join("epubs", docId + ".epub"),
    ],
  });

  let { code, stdout, stderr } = await cmd.output();
  // stdout & stderr are a Uint8Array
  console.log(new TextDecoder().decode(stdout)); // hello world
  console.log(new TextDecoder().decode(stderr)); // hello world
  return true;
}

async function parseDocument(workDir: string): Promise<ParseResult | null> {
  const rawContentFile = path.join(workDir, RAW_HTML_FILENAME);
  const rawContent = await Deno.readTextFile(rawContentFile);

  const doc = new JSDOM(rawContent, {
    url: url,
  });
  const reader = new Readability(doc.window.document);
  return reader.parse();
}

async function generateMetadata(parseResult: ParseResult) {
  const metadata = {
    title: parseResult?.title,
    date: parseResult?.publishedTime,
    lang: parseResult?.lang,
  };

  const encoder = new TextEncoder();
  const bytes = encoder.encode(stringify(metadata));
  const metadataFile = path.join(workDir, "metadata.yaml");

  await Deno.writeFile(metadataFile, bytes);
}

async function generateContent(parseResult: ParseResult, url: string) {
  // const title = parseResult?.title;
  const description = parseResult?.excerpt;
  const content = parseResult?.content;

  let htmlContent = "";
  if (description) {
    htmlContent = htmlContent + "<h3>" + description + "</h3>";
  }
  if (content) {
    htmlContent = htmlContent + content;
  }
  htmlContent = htmlContent + '<p>Source: <a href="' + url + ' ">' + url + '</a></p>';

  const extractedContentFile = path.join(workDir, EXTRACTED_HTML_FILENAME);

  const encoder = new TextEncoder();
  const bytes = encoder.encode(htmlContent);

  await Deno.writeFile(extractedContentFile, bytes);
}

const url =
  "https://dzone.com/articles/java-11-to-21-a-visual-guide-for-seamless-migratio";

// TODO Wenn es nicht existiert, dann per Curl herunterladen ...
createDir("epubs");
createDir("workspaces");
const docId = extractDocId(url);
const workDir = path.join("workspaces", docId);
createDir(workDir);

const result = await parseDocument(workDir);
if (result != null) {
  generateContent(result, url);
  // TODO Extract Metadta
  generateMetadata(result);
  await generateEpub(workDir, docId);
}

// fs.writeFileSync(prefix + "content-readability.html", article.content);
// delete article.content;
// delete article.textContent;
// fs.writeFileSync(prefix + "metadata-readability.json" , JSON.stringify(article));

// // Learn more at https://docs.deno.com/runtime/manual/examples/module_metadata#concepts
// if (import.meta.main) {
//   const s1: number = 5;
//   const s2 = "Hallo";
//   const sum: number = s1 + s2;
//   console.log(Deno.args);
//   console.log(!sum);

//   console.log("Add 2 + 3 =", add(2, 3));
// }
// Pandoc execution
// pandoc -f html -t epub2 dzone-readability-content.html --metadata title="My Title" --epub-title-page=false   -o bla.epub
