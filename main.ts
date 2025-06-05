import * as path from "jsr:@std/path";
import { readAll } from "jsr:@std/io";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { stringify } from "jsr:@std/yaml";
import { Builder } from "selenium-webdriver";
import * as firefox from "selenium-webdriver/firefox";
import { parseArgs } from "jsr:@std/cli/parse-args";
import os from "node:os";

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

class SeleniumFirefoxDownloader {
  seleniumDriver: any = undefined;
  options: any = undefined;

  constructor(profile: string) {
    this.options = new firefox.Options()
      .setProfile(profile);
  }

  async fetchUrl(url: string): Promise<string | undefined> {
    if (!this.seleniumDriver) {
      this.seleniumDriver = await new Builder().forBrowser("firefox")
        .setFirefoxOptions(this.options)
        .build();
    }
    await this.seleniumDriver.get(url);

    return await this.seleniumDriver.getPageSource();
  }

  async destructor() {
    if (this.seleniumDriver) {
      await this.seleniumDriver.quit();
    }
  }
}

let firefoxDownloader: SeleniumFirefoxDownloader;

const EXTRACTED_HTML_FILENAME = "extracted.html";
const RAW_HTML_FILENAME = "document-raw.html";
const RAW_METADATA_FILENAME = "metadata-raw.yaml";

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

async function fileExists(path: string): Promise<boolean> {
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

  const { code, stdout, stderr } = await cmd.output();
  console.log(new TextDecoder().decode(stdout)); // hello world
  console.log(new TextDecoder().decode(stderr)); // hello world
  return true;
}

async function fetchContent(
  workDir: string,
  url: string,
  firefox: boolean,
) {
  const rawContentFile = path.join(workDir, RAW_HTML_FILENAME);

  const contentPresent = await fileExists(rawContentFile);
  if (contentPresent) {
    console.log(RAW_HTML_FILENAME + " exists, nothing to do.");
    return;
  }
  if (firefox) {
    const body = await callFirefox(url);
    const encoder = new TextEncoder();
    await Deno.writeFile(rawContentFile, encoder.encode(body));

    return;
  }

  const textResponse = await fetch(url);
  const body = await textResponse.body;
  if (body != null) {
    await Deno.writeFile(rawContentFile, body);
  }
}

async function parseDocument(
  workDir: string,
  url: string,
): Promise<ParseResult | null> {
  const rawContentFile = path.join(workDir, RAW_HTML_FILENAME);
  const rawContent = await Deno.readTextFile(rawContentFile);

  const doc = new JSDOM(rawContent, {
    url: url,
  });
  const reader = new Readability(doc.window.document);
  return reader.parse();
}

async function generateMetadata(workDir: string, parseResult: ParseResult) {
  const metadata = {
    author: parseResult?.byline,
    title: parseResult?.title,
    date: parseResult?.publishedTime,
    lang: parseResult?.lang,
  };

  const encoder = new TextEncoder();
  const bytes = encoder.encode(stringify(metadata));
  const metadataFile = path.join(workDir, "metadata.yaml");
  await Deno.writeFile(metadataFile, bytes);

  delete parseResult?.content;
  delete parseResult?.textContent;

  const rawMetadataBytes = encoder.encode(stringify(parseResult));
  const rawMetadataFile = path.join(workDir, RAW_METADATA_FILENAME);
  await Deno.writeFile(rawMetadataFile, rawMetadataBytes);
}

async function generateContent(
  workDir: string,
  url: string,
  parseResult: ParseResult,
) {
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
  htmlContent = htmlContent + '<p>Source: <a href="' + url + ' ">' + url +
    "</a></p>";

  const extractedContentFile = path.join(workDir, EXTRACTED_HTML_FILENAME);

  const encoder = new TextEncoder();
  const bytes = encoder.encode(htmlContent);

  await Deno.writeFile(extractedContentFile, bytes);
}

async function createEpub(
  url: string,
  flags: {
    [x: string]: unknown;
    profile?: string | undefined;
    profileUrl?: string | undefined;
    firefox: boolean;
    help: boolean;
    _: Array<string | number>;
  },
) {
  console.log("Create epub for %s", url);

  createDir("epubs");
  createDir("workspaces");
  const docId = extractDocId(url);
  const workDir = path.join("workspaces", docId);
  createDir(workDir);

  await fetchContent(
    workDir,
    url,
    flags.firefox,
  );

  const result = await parseDocument(workDir, url);
  if (result != null) {
    generateContent(workDir, url, result);
    generateMetadata(workDir, result);
    await generateEpub(workDir, docId);
  }
  console.log("Done.");
}

async function callFirefox(url: string): Promise<string> {
  if (firefoxDownloader) {
    const fetchedContent = await firefoxDownloader.fetchUrl(url);
    if (fetchedContent) {
      return fetchedContent;
    }
  }
  return "";
}

async function findFirefoxProfile(name: string): Promise<string | undefined> {
  let profiles = os.homedir();
  if (os.platform() == "darwin") {
    profiles = path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "Firefox/Profiles",
    );
  } else if (os.platform() == "win32") {
    profiles = path.join(
      os.homedir(),
      "AppData",
      "Local",
      "Mozilla",
      "Firefox/Profiles",
    );
  }

  let profileDir: string | undefined = undefined;
  for await (const dirEntry of Deno.readDir(profiles)) {
    if (flags.profile && dirEntry.isDirectory && dirEntry.name.endsWith(name)) {
      profileDir = path.join(profiles, dirEntry.name);
    }
  }
  // On Windows this is the expected file dir syntax by Geckodriver
  if (os.platform() == "win32") {
    profileDir = profileDir?.replaceAll("\\", "/");
  }
  return profileDir;
}

const flags = parseArgs(Deno.args, {
  boolean: ["help", "firefox"],
  string: ["profile", "profileUrl"],
});

if (flags.firefox && flags.profile && !flags.profileUrl) {
  flags["profileUrl"] = await findFirefoxProfile(flags.profile);
}

if (flags["profileUrl"]) {
  firefoxDownloader = new SeleniumFirefoxDownloader(flags["profileUrl"]);
}

if (import.meta.main && flags._.length > 0) {
  // TODO Validate url
  const url = flags._[0].toString();
  if (url) {
    await createEpub(url, flags);
  }
}

if (import.meta.main && flags._.length == 0) {
  const stdinContent = await readAll(Deno.stdin);
  const response = new TextDecoder().decode(stdinContent).split("\n");
  for (const line of response) {
    if (line) {
      await createEpub(line, flags);
    }
  }
}

// cleanup
if (firefoxDownloader) {
  await firefoxDownloader.destructor();
}
