#!/usr/bin/env node
// enrich-roster.js — queries Microsoft Graph for job titles and updates team-data.json roster
// Run after normalize.js: node enrich-roster.js
// Requires: az CLI authenticated (az login)
"use strict";

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const DATA_PATH = path.join(__dirname, "data", "team-data.json");

// Job title keywords that indicate non-engineering roles (badge-exempt)
const PM_KEYWORDS = /product\s*manager|program\s*manager|product\s*architect|product\s*designer|design|content/i;
const ENG_KEYWORDS = /software\s*engineer|sde|swe|developer/i;

function getGraphToken() {
  try {
    return execSync(
      "az account get-access-token --resource https://graph.microsoft.com --query accessToken -o tsv",
      { encoding: "utf8", timeout: 15000 }
    ).trim();
  } catch {
    console.error("Failed to get Graph token. Run: az login");
    process.exit(1);
  }
}

async function lookupUser(name, token) {
  const search = encodeURIComponent(`"displayName:${name}"`);
  const url = `https://graph.microsoft.com/v1.0/users?$search=${search}&$select=displayName,jobTitle,department&$top=3`;
  try {
    const resp = await fetch(url, {
      headers: { Authorization: "Bearer " + token, ConsistencyLevel: "eventual" },
    });
    const data = await resp.json();
    if (data.value && data.value.length > 0) {
      const first = name.split(" ")[0].toLowerCase();
      const last = name.split(" ").slice(1).join(" ").toLowerCase();
      // Match both first AND last name, skip alt/service accounts
      const match = data.value.find(u => {
        const dn = u.displayName.toLowerCase().replace(/\s*\([^)]*\)/g, '');
        if (u.displayName.includes('NON EA SC ALT')) return false;
        return dn.includes(first) && dn.includes(last);
      });
      if (match) return { jobTitle: match.jobTitle, department: match.department, displayName: match.displayName };
    }
  } catch {}
  return { jobTitle: null, department: null };
}

function classifyTitle(jobTitle) {
  if (!jobTitle) return null;
  if (PM_KEYWORDS.test(jobTitle)) return "pm";
  if (/manager|director|vp\b|vice president/i.test(jobTitle)) return "eng-manager";
  if (ENG_KEYWORDS.test(jobTitle)) return "engineer";
  return null;
}

async function main() {
  if (!fs.existsSync(DATA_PATH)) {
    console.error("team-data.json not found. Run normalize.js first.");
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  const roster = data.roster || {};

  // Collect all unique assigned people (roster + items)
  const allPeople = new Set(Object.keys(roster));
  for (const item of data.items || []) {
    if (item.assigned && item.assigned !== "Unassigned") allPeople.add(item.assigned);
  }

  console.log(`Enriching ${allPeople.size} people from Graph...`);
  const token = getGraphToken();

  let updated = 0;
  for (const name of allPeople) {
    if (name.includes("NON EA SC ALT")) continue;
    // Strip pronouns from display name for search
    const cleanName = name.replace(/\s*\([^)]*\)\s*$/, "").trim();
    const result = await lookupUser(cleanName, token);

    if (result.jobTitle) {
      const role = classifyTitle(result.jobTitle);
      if (!roster[name]) roster[name] = {};
      roster[name].jobTitle = result.jobTitle;
      if (role) roster[name].titleRole = role;
      updated++;
      console.log(`  ${name}: ${result.jobTitle} → ${role || "unclassified"}`);
    }
  }

  data.roster = roster;
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), "utf8");
  console.log(`Done. ${updated}/${allPeople.size} enriched → ${DATA_PATH}`);
}

main();
