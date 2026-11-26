#!/usr/bin/env node
// openGym suomeksi: kellosovellusten ja iOS-widgettien omat tekstit.
//
//   node natiivit.mjs pura  --repo <openGym>   -> natiivit-lahde.json (englanti + vihjeet) tämän skriptin viereen
//   node natiivit.mjs liita --repo <openGym> --fi <natiivit-fi.json>
//        lisää suomen generaattoreihin (kieliluettelo + käännökset) ja ajaa ne
//
// Generaattorit kirjoittavat kellojen kielitiedostot. Ne luetaan tässä "kuivana": tiedostoihin
// kirjoittavat funktiot korvataan tyhjillä, jotta taulukot saadaan ulos koskematta mihinkään.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i === -1 ? d : argv[i + 1] }
const REPO = path.resolve(opt('repo', process.cwd()))

// pinta: tiedosto, taulukot, englannin ja vihjeiden kielikoodit, suomen koodi taulukossa,
// ja rivi, jonka eteen suomi lisätään.
export const SURFACES = {
  'apple-watch': {
    file: 'frontend/ios/ci/watch-strings.mjs', tables: ['OWN', 'PLIST'], en: 'key', de: 'de', sv: 'sv', fi: 'fi',
    before: 'const esc = s =>', langLine: [/(\n  da: 'da',\n)/, "$1  fi: 'fi',\n"],
    note: 'Apple Watch app. "iPhone" stays. %@ is a name, %lld a number.',
  },
  'wear-os': {
    file: 'frontend/android/wear/wear-strings.mjs', tables: ['OWN'], en: 'en', de: 'de', sv: 'sv', fi: 'fi',
    before: null, langLine: [/(\n  da: \[\['values-da'\], 'da'\],\n)/, "$1  fi: [['values-fi'], 'fi'],\n"],
    note: 'Wear OS watch app ("phone", not "iPhone"). %1$s is a name, %1$d a number.',
  },
  garmin: {
    file: 'frontend/garmin/garmin-strings.mjs', tables: ['OWN'], en: 'eng', de: 'deu', sv: 'swe', fi: 'fin',
    before: '/* ---------- reading the sources ---------- */', langLine: [/(dan: \['values-da', 'da'\],)/, "$1 fin: ['values-fi', 'fi'],"],
    note: 'Garmin watch app. No placeholders allowed.',
  },
  zepp: {
    file: 'watch-zepp/zepp-strings.mjs', tables: ['OWN', 'SETTING'], en: 'en', de: 'de', sv: 'sv', fi: 'fi',
    before: null, langLine: [/(zh: \['values-zh', 'zh-CN'\], 'zh-TW': \['values-zh-rTW', 'zh-TW'\],\n)/, "$1  fi: ['values-fi', 'fi-FI'],\n"],
    note: 'Zepp OS watch app and its settings page in the Zepp phone app.',
  },
  'ios-widgets': {
    file: 'frontend/ios/ci/widget-strings.mjs', tables: ['STRINGS'], en: 'key', de: 'de', sv: 'sv', fi: 'fi',
    before: null, langLine: [/(const LPROJ = \[[^\]]*'zh-Hant')\]/, "$1, 'fi']"],
    note: 'iPhone home-screen widgets: names and descriptions in the widget gallery.',
  },
}

async function loadTables(s) {
  const src = path.join(REPO, s.file)
  let text = fs.readFileSync(src, 'utf8')
  text = text.replace(/import \{([^}]*)\} from 'node:fs'/, (m, names) => {
    const keep = names.split(',').map(x => x.trim()).filter(x => x && x !== 'writeFileSync' && x !== 'mkdirSync')
    return `import { ${keep.join(', ')} } from 'node:fs'; const writeFileSync = () => {}, mkdirSync = () => {}`
  }).replace(/process\.exit\(/g, '(() => {})(')
  text += '\nexport const __T = {' + s.tables.map(t => `${t}: typeof ${t} === 'undefined' ? undefined : ${t}`).join(', ') + '}\n'
  const tmp = src.replace(/\.mjs$/, '.__pura.mjs')
  fs.writeFileSync(tmp, text)
  const log = console.log; console.log = () => {}
  try { return (await import(pathToFileURL(tmp).href)).__T } finally { console.log = log; fs.unlinkSync(tmp) }
}

async function pura() {
  const out = {}
  const plistEn = {}
  const plist = fs.readFileSync(path.join(REPO, 'frontend/ios/App/Watch/Info.plist'), 'utf8')
  for (const m of plist.matchAll(/<key>(NS\w+UsageDescription)<\/key>\s*<string>([^<]*)<\/string>/g)) plistEn[m[1]] = m[2]
  for (const [name, s] of Object.entries(SURFACES)) {
    const T = await loadTables(s)
    for (const t of s.tables) {
      for (const [k, by] of Object.entries(T[t] || {})) {
        const en = t === 'PLIST' ? plistEn[k] : s.en === 'key' ? k : by[s.en]
        if (!en) throw new Error(`${name} ${t}.${k}: no English`)
        out[`${name}|${t}|${k}`] = { en, de: by[s.de], sv: by[s.sv], where: s.note }
      }
    }
  }
  const p = path.join(HERE, 'natiivit-lahde.json')
  fs.writeFileSync(p, JSON.stringify(out, null, 1) + '\n')
  console.log(`${Object.keys(out).length} merkkijonoa -> ${p}`)
}

async function liita() {
  const fi = JSON.parse(fs.readFileSync(path.resolve(opt('fi')), 'utf8'))
  for (const [name, s] of Object.entries(SURFACES)) {
    const p = path.join(REPO, s.file)
    let text = fs.readFileSync(p, 'utf8')
    if (text.includes('// Finnish: ')) { console.log(name + ': suomi on jo mukana'); continue }
    const [re, rep] = s.langLine
    if (!re.test(text)) throw new Error(name + ': kieliluettelon kohtaa ei löytynyt')
    text = text.replace(re, rep)
    const lines = s.tables.map(t => {
      const rows = Object.fromEntries(Object.entries(fi).filter(([k]) => k.startsWith(`${name}|${t}|`)).map(([k, v]) => [k.split('|').slice(2).join('|'), v]))
      return `for (const [k, v] of Object.entries(${JSON.stringify(rows)})) ${t}[k]${s.fi.includes('-') ? `['${s.fi}']` : '.' + s.fi} = v`
    })
    const block = `// Finnish: the lines only this ${name === 'ios-widgets' ? 'widget' : 'watch'} says (translated with Gemini, reviewed by a native speaker).\n${lines.join('\n')}\n`
    if (s.before) {
      if (!text.includes(s.before)) throw new Error(name + ': lisäyskohtaa ei löytynyt')
      text = text.replace(s.before, block + '\n' + s.before)
    } else {
      // Heti viimeisen taulukon määrittelyn jälkeen (ennen kuin mitään kirjoitetaan).
      const last = s.tables.at(-1)
      const start = text.search(new RegExp(`\\n(export )?const ${last} = \\{`))
      let i = text.indexOf('{', start), depth = 0
      for (; i < text.length; i++) { if (text[i] === '{') depth++; else if (text[i] === '}' && --depth === 0) break }
      // Jatkorivit (Object.assign(OWN...), OWN.x = ...) kuuluvat vielä taulukkoon.
      let end = text.indexOf('\n', i) + 1
      const rest = text.slice(end).split('\n')
      let n = 0
      while (n < rest.length && (rest[n].trim() === '' || rest[n].startsWith('//') || new RegExp(`^(Object\\.assign\\(${last}|${last}[.\\[]|for \\(const \\[k, v\\] of Object\\.entries\\(.*\\)\\) ${last})`).test(rest[n]))) n++
      while (n > 0 && (rest[n - 1].trim() === '' || rest[n - 1].startsWith('//'))) n--
      end += rest.slice(0, n).join('\n').length + (n ? 1 : 0)
      text = text.slice(0, end) + '\n' + block + text.slice(end)
    }
    fs.writeFileSync(p, text)
    console.log(name + ': lisätty')
  }
  // Garmin tarvitsee kielen myös manifestiin.
  const man = path.join(REPO, 'frontend/garmin/manifest.xml')
  let m = fs.readFileSync(man, 'utf8')
  if (!m.includes('<iq:language>fin</iq:language>')) {
    m = m.replace(/(\n(\s*)<iq:language>dan<\/iq:language>)/, '$1\n$2<iq:language>fin</iq:language>')
    fs.writeFileSync(man, m)
  }
  for (const f of ['frontend/ios/ci/watch-strings.mjs', 'frontend/android/wear/wear-strings.mjs', 'frontend/garmin/garmin-strings.mjs', 'watch-zepp/zepp-strings.mjs', 'frontend/ios/ci/widget-strings.mjs']) {
    console.log(execFileSync(process.execPath, [path.join(REPO, f)], { cwd: REPO, encoding: 'utf8' }).trim())
  }
}

const cmd = argv[0]
if (cmd === 'pura') await pura()
else if (cmd === 'liita') await liita()
else { console.log('node natiivit.mjs pura|liita --repo <openGym> [--fi natiivit-fi.json]'); process.exit(1) }
