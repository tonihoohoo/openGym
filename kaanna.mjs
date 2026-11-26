#!/usr/bin/env node
// openGym suomeksi: kääntää käyttöliittymän ja liikepankin OpenRouterin kautta.
//
//   node kaanna.mjs mallit                          listaa OpenRouterin Google-mallit
//   node kaanna.mjs sanasto                         Gemini oikolukee sanasto.json:n (ensin!)
//   node kaanna.mjs ui        --repo C:\koodi\openGym  käyttöliittymä  -> frontend/src/locales/fi.js
//   node kaanna.mjs liikkeet  --repo C:\koodi\openGym  liikepankki     -> catalogue/i18n/fi.json
//   node kaanna.mjs natiivit                        kellojen ja widgettien tekstit: natiivit-lahde.json -> tyo\natiivit-fi.json
//   node kaanna.mjs tarkistus --repo C:\koodi\openGym  CSV-tiedostot läpiluentaan (Excel)
//
// Valinnat:
//   --model <id>        OpenRouterin mallin tunnus (tai ympäristömuuttuja OPENROUTER_MODEL)
//   --limit <n>         käännä vain n uutta kohdetta (koeajo)
//   --batch <n>         kohteita per pyyntö (ui: 60, liikkeet: 8)
//   --rinnakkain <n>    yhtä aikaa käynnissä olevat pyynnöt (oletus 4)
//   --sanasto <polku>   sanastotiedosto (oletus: sanasto.json tämän skriptin vieressä)
//   --tyo <kansio>      välimuistin kansio (oletus: tyo\ tämän skriptin vieressä)
//   --kuiva             näytä ensimmäinen pyyntö lähettämättä mitään
//
// API-avain luetaan ympäristömuuttujasta OPENROUTER_API_KEY. Työ tallentuu välimuistiin jokaisen
// erän jälkeen, joten Ctrl+C on turvallinen: sama komento jatkaa siitä mihin jäätiin. Jo
// käännettyjä (myös repossa olevia fi.js / fi.json -rivejä) ei käännetä uudelleen, joten kun
// upstream lisää uusia merkkijonoja, sama komento kääntää vain uudet.
//
// Ei riippuvuuksia: Node 20 tai uudempi riittää.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------- argumentit
const argv = process.argv.slice(2)
const cmd = argv[0]
const opt = (name, def) => {
  const i = argv.indexOf('--' + name)
  return i === -1 ? def : argv[i + 1]
}
const flag = name => argv.includes('--' + name)

const REPO = path.resolve(opt('repo', process.cwd()))
const MODEL = opt('model', process.env.OPENROUTER_MODEL || '')
const LIMIT = Number(opt('limit', 0)) || Infinity
const CONC = Number(opt('rinnakkain', 4)) || 4
const WORK = path.resolve(opt('tyo', path.join(HERE, 'tyo')))
const GLOSSARY_PATH = path.resolve(opt('sanasto', path.join(HERE, 'sanasto.json')))
const DRY = flag('kuiva')
const KEY = process.env.OPENROUTER_API_KEY || ''

const die = msg => { console.error('\nVIRHE: ' + msg + '\n'); process.exit(1) }

// ---------------------------------------------------------------- tiedostot
const readJSON = (p, def) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return def } }
const writeAtomic = (p, text) => {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  const tmp = p + '.tmp'
  fs.writeFileSync(tmp, text, 'utf8')
  fs.renameSync(tmp, p)
}
const importDefault = async p => (await import(pathToFileURL(p).href + '?t=' + Date.now())).default

function glossaryText() {
  const g = readJSON(GLOSSARY_PATH, null)
  if (!g) return ''
  const rows = Object.entries(g).filter(([k]) => !k.startsWith('_'))
  if (!rows.length) return ''
  return '\nGlossary (use these Finnish terms consistently, inflect them as Finnish grammar needs):\n' +
    rows.map(([en, fi]) => `- ${en} = ${fi}`).join('\n') + '\n'
}

// ---------------------------------------------------------------- OpenRouter
let spent = 0, tokIn = 0, tokOut = 0
async function chat(system, user, { json = true } = {}) {
  const body = {
    model: MODEL,
    temperature: 0.2,
    max_tokens: 32000,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    usage: { include: true },
  }
  if (json) body.response_format = { type: 'json_object' }
  for (let attempt = 1; ; attempt++) {
    let res, text
    try {
      res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + KEY,
          'Content-Type': 'application/json',
          'X-Title': 'openGym Finnish translation',
        },
        body: JSON.stringify(body),
      })
      text = await res.text()
    } catch (e) {
      if (attempt >= 6) throw e
      await sleep(2000 * attempt); continue
    }
    if (res.status === 400 && json && /response_format|json/i.test(text)) {
      // Malli ei tue JSON-tilaa: yritetään ilman, kehote pyytää silti pelkkää JSONia.
      delete body.response_format; json = false; continue
    }
    if (res.status === 401 || res.status === 403) die('OpenRouter hylkäsi avaimen (' + res.status + '): ' + text.slice(0, 300))
    if (res.status === 402) die('OpenRouterin saldo loppui (402). Lisää krediittejä ja aja sama komento uudelleen.')
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 8) throw new Error('OpenRouter ' + res.status + ': ' + text.slice(0, 300))
      await sleep(Math.min(60000, 3000 * 2 ** (attempt - 1))); continue
    }
    if (!res.ok) throw new Error('OpenRouter ' + res.status + ': ' + text.slice(0, 500))
    const data = JSON.parse(text)
    if (data.error) {
      if (attempt >= 6) throw new Error('OpenRouter: ' + JSON.stringify(data.error).slice(0, 300))
      await sleep(3000 * attempt); continue
    }
    const u = data.usage || {}
    tokIn += u.prompt_tokens || 0; tokOut += u.completion_tokens || 0; spent += u.cost || 0
    const content = data.choices?.[0]?.message?.content ?? ''
    return parseJSON(content)
  }
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
function parseJSON(s) {
  s = String(s).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  const a = s.indexOf('{'), b = s.lastIndexOf('}')
  if (a === -1 || b === -1) throw new Error('vastaus ei ollut JSONia: ' + s.slice(0, 200))
  return JSON.parse(s.slice(a, b + 1))
}

// Ajaa erät N rinnakkaisella työntekijällä.
async function pool(items, n, fn) {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; await fn(items[k], k) }
  }))
}

function chunk(list, max, maxChars, size) {
  const out = []; let cur = [], chars = 0
  for (const x of list) {
    const c = size(x)
    if (cur.length && (cur.length >= max || chars + c > maxChars)) { out.push(cur); cur = []; chars = 0 }
    cur.push(x); chars += c
  }
  if (cur.length) out.push(cur)
  return out
}

const progress = (done, total, failed) =>
  process.stdout.write(`\r  ${done}/${total} valmis, ${failed} epäonnistui · ${tokIn} + ${tokOut} tokenia` +
    (spent ? ` · ${spent.toFixed(3)} $` : '') + '   ')

// ---------------------------------------------------------------- tarkistukset
const marks = s => [...String(s).matchAll(/\{\d+\}/g)].map(m => m[0]).sort().join(' ')
const KEEP = ['openGym', 'http://', 'https://', '%1RM']
function checkUi(en, fi) {
  if (typeof fi !== 'string' || !fi.trim()) return 'tyhjä'
  if (fi !== fi.trim()) return 'välilyönti alussa tai lopussa'
  if (marks(en) !== marks(fi)) return `paikkamerkit eivät täsmää (${marks(en) || '-'} vs ${marks(fi) || '-'})`
  if (fi.includes('—')) return 'ajatusviiva (—), projekti ei käytä niitä'
  for (const k of KEEP) if (en.includes(k) && !fi.includes(k)) return `"${k}" puuttuu`
  return null
}

// ---------------------------------------------------------------- käyttöliittymä
const UI_SYSTEM = () => `You translate the user interface of openGym, a free, open-source workout tracker (phone app, web app and watch apps), from English into Finnish.

Write natural, idiomatic Finnish as a native speaker would see it in a well-made Finnish app. Not word-for-word.
Rules:
- Address the user informally with "sinä" forms (or neutral passive/imperative), never "te". The English copy is plain, friendly and a bit witty: keep that tone, keep it short.
- Short strings are buttons, tabs, labels and headings. Button actions are imperative verbs ("Tallenna", "Peruuta", "Poista"). Headings and labels are nouns. Keep them as short as the English.
- Placeholders {0}, {1}, {2} stand for numbers, names or dates. Keep every placeholder exactly, the same ones and the same count. You may move them. Avoid putting a case ending directly on a placeholder; rephrase instead (for example "Liike: {0}"). If unavoidable, use a colon: "{0}:n".
- Keep product and brand names as they are: openGym, Apple Health, Apple Watch, iPhone, Android, Wear OS, Garmin, Zepp, Health Connect, Strava, Hevy, Strong, Tailscale, WebDAV, Nextcloud, Gym visual, GitHub, passkey brand names, etc. Keep URLs, "http://", "https://" and file extensions unchanged.
- Keep units and training abbreviations as they are: kg, lb, cm, in, km, mi, RPE, RIR, 1RM, %1RM, AMRAP, HIIT, EMOM. "PR" (personal record) is "ennätys".
- Never use an em dash (—). Use a comma, colon or a new sentence. Finnish quotation marks are ” ” (same mark both sides). Use ’ for apostrophes.
- Keep sentence-final punctuation as in the English (a label without a period stays without one).
- The Swedish ("sv") and German ("de") translations are hints for the meaning of ambiguous short strings only. Translate from the English.
${glossaryText()}
You get a JSON object {"id": {"en": "...", "sv": "...", "de": "..."}}. The strings come in the order they appear in the app's source, so neighbours share context.
Answer with only a JSON object {"id": "Finnish translation"} with exactly the same ids.`

async function runUi() {
  const dir = path.join(REPO, 'frontend', 'src', 'locales')
  if (!fs.existsSync(dir)) die('Kansiota ' + dir + ' ei löydy. Anna openGym-repon polku: --repo C:\\polku\\openGym')
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js') && f !== 'fi.js')
  const packs = {}
  for (const f of files) packs[f.slice(0, -3)] = await importDefault(path.join(dir, f))
  // Lähde = kaikkien kielten avaimet. Avaimet, jotka ovat vain italiassa, ovat tarkoituksella
  // vain italiaa (check-locales.mjs), joten ne jätetään pois.
  const count = new Map()
  for (const [lang, d] of Object.entries(packs)) for (const k of Object.keys(d)) {
    const c = count.get(k) || new Set(); c.add(lang); count.set(k, c)
  }
  const order = [...new Set([...Object.keys(packs.da || {}), ...Object.keys(packs.sv || {}), ...count.keys()])]
  const keys = order.filter(k => !(count.get(k).size === 1 && count.get(k).has('it')))
  const hint = (lang, k) => { const v = packs[lang]?.[k]; return typeof v === 'string' ? v : v && typeof v === 'object' ? (v.other || Object.values(v)[0]) : undefined }

  const cachePath = path.join(WORK, 'ui-cache.json')
  const outPath = path.join(dir, 'fi.js')
  const done = { ...(fs.existsSync(outPath) ? await importDefault(outPath) : {}), ...readJSON(cachePath, {}) }
  const todo = keys.filter(k => !(typeof done[k] === 'string' && done[k].trim())).slice(0, LIMIT)
  console.log(`Käyttöliittymä: ${keys.length} merkkijonoa, ${keys.length - keys.filter(k => !done[k]).length} jo käännetty, nyt käännetään ${todo.length}.`)

  const batches = chunk(todo, Number(opt('batch', 60)), 7000, k => k.length + (hint('sv', k) || '').length)
  const failed = new Map()
  let finished = 0
  const translate = async (batch, retry = false) => {
    const input = Object.fromEntries(batch.map((k, i) => [String(i + 1), { en: k, sv: hint('sv', k), de: hint('de', k) }]))
    let user = JSON.stringify(input, null, 1)
    if (retry) user = 'This string is shown in a narrow space (button, tab, chip or heading). The Finnish must be at most ' +
      batch.map(k => Math.ceil(limitFor(k) * 1.15) + 2).join(', ') + ' characters long. Use a shorter word or a common abbreviation, keep the meaning.\n' + user
    if (DRY) { console.log('\n--- system ---\n' + UI_SYSTEM() + '\n--- user ---\n' + user); process.exit(0) }
    let out
    try { out = await chat(UI_SYSTEM(), user) } catch (e) { for (const k of batch) failed.set(k, String(e.message || e)); return }
    const again = []
    batch.forEach((k, i) => {
      const fi = out[String(i + 1)]
      const err = checkUi(k, fi)
      const long = !err && tooLong(k, fi)
      if (!err && !(long && !retry)) {
        done[k] = fi; failed.delete(k)
        if (long) longOnes.set(k, fi); else longOnes.delete(k)
      } else if (!retry) again.push(k); else failed.set(k, err + ' -> ' + JSON.stringify(fi))
    })
    writeAtomic(cachePath, JSON.stringify(done, null, 1))
    // Hylätyt ja liian pitkät yritetään vielä kerran, yksitellen ja lyhyyttä korostaen.
    for (const k of again) await translate([k], true)
  }
  // Lyhyt merkkijono (nappi, välilehti, otsikko) saa olla korkeintaan noin pisimmän nykyisen
  // käännöksen (saksa, unkari, ruotsi...) mittainen: niihin asettelu on jo joutunut mukautumaan.
  const longOnes = new Map(Object.entries(readJSON(path.join(WORK, 'ui-pitkat.json'), {})))
  function limitFor(k) {
    const lens = Object.keys(packs).map(l => (hint(l, k) || '').length)
    return Math.max(k.length, ...lens)
  }
  function tooLong(k, fi) {
    if (k.length > 30) return false
    return fi.length > Math.ceil(limitFor(k) * 1.15) + 2
  }
  if (!todo.length) { writeUi(keys, done, outPath); return }
  if (!MODEL) die('Mallia ei ole valittu. Anna --model <id> tai aseta OPENROUTER_MODEL. Katso tunnukset: node kaanna.mjs mallit')
  if (!KEY && !DRY) die('OPENROUTER_API_KEY puuttuu.')
  await pool(batches, CONC, async b => { await translate(b); finished += b.length; progress(finished, todo.length, failed.size) })
  console.log('')
  writeUi(keys, done, outPath)
  writeAtomic(path.join(WORK, 'ui-pitkat.json'), JSON.stringify(Object.fromEntries(longOnes), null, 1))
  if (longOnes.size) console.log(`${longOnes.size} lyhyttä merkkijonoa on yhä pitkiä (hyväksytty, mutta luettava läpi): tarkistus-ui.csv, sarake huomio.`)
  report(failed, 'ui-virheet.txt')
}

function writeUi(keys, done, outPath) {
  const lines = keys.filter(k => typeof done[k] === 'string' && done[k].trim())
    .map(k => `  ${JSON.stringify(k)}: ${JSON.stringify(done[k])},`)
  const text = '// Finnish UI strings. Keys are the English source strings (see lib/i18n.js).\n' +
    'export default {\n' + lines.join('\n') + '\n}\n'
  writeAtomic(outPath, text)
  console.log(`Kirjoitettu ${path.relative(REPO, outPath)}: ${lines.length}/${keys.length} merkkijonoa.`)
}

function report(failed, name) {
  const p = path.join(WORK, name)
  if (!failed.size) { if (fs.existsSync(p)) fs.unlinkSync(p); console.log('Ei virheitä.'); return }
  writeAtomic(p, [...failed].map(([k, e]) => `${k}\n  ${e}`).join('\n\n') + '\n')
  console.log(`${failed.size} kohdetta jäi kääntämättä (ne näkyvät sovelluksessa englanniksi). Lista: ${p}\nAja sama komento uudelleen, niin ne yritetään vielä.`)
}

// ---------------------------------------------------------------- liikepankki
const EX_SYSTEM = () => `You translate exercises of openGym's exercise library, a free, open-source workout tracker, from English into Finnish.

Each exercise has a name, a short description and numbered steps. Write natural, clear Finnish as a Finnish personal trainer would write it. Not word-for-word.
Rules:
- "name": a short Finnish exercise name as Finnish gym-goers say it, in lowercase (like the English), except that is how it is stored. Keep it short. Use established Finnish names where they exist (for example "penkkipunnerrus", "maastaveto", "kyykky", "leuanveto", "hauiskääntö"); otherwise describe it plainly: equipment and variant words as in the glossary. Distinguish variants: if two English names differ, the Finnish names must differ too.
- "description": one or two plain sentences, same meaning.
- "instructions": exactly the same number of steps as the English, step by step in the same order. Address the reader with "sinä" imperatives ("Asetu", "Tartu", "Laske"). One step stays one step.
- Describe the movement only. No medical advice.
- Never use an em dash (—). No quotation marks around exercise names.
- The German ("de") and Swedish ("sv") names are only hints for what the exercise is.
${glossaryText()}
You get a JSON object {"id": {"name": "...", "description": "...", "instructions": ["...", ...], "de": "...", "sv": "..."}}.
Answer with only a JSON object {"id": {"name": "...", "description": "...", "instructions": ["...", ...]}} with exactly the same ids.`

function checkEx(en, fi) {
  if (!fi || typeof fi !== 'object') return 'puuttuu'
  if (typeof fi.name !== 'string' || !fi.name.trim()) return 'nimi puuttuu'
  if (en.description && (typeof fi.description !== 'string' || !fi.description.trim())) return 'kuvaus puuttuu'
  const steps = en.instructions || []
  if (steps.length && (!Array.isArray(fi.instructions) || fi.instructions.length !== steps.length)) return `vaiheita ${fi.instructions?.length ?? 0}, englanniksi ${steps.length}`
  if (steps.length && fi.instructions.some(s => typeof s !== 'string' || !s.trim())) return 'tyhjä vaihe'
  const all = [fi.name, fi.description || '', ...(fi.instructions || [])].join(' ')
  if (all.includes('—')) return 'ajatusviiva (—)'
  return null
}
const cleanEx = (en, fi) => {
  const r = { name: fi.name.trim().toLowerCase() }
  if (en.description) r.description = fi.description.trim()
  if (en.instructions?.length) r.instructions = fi.instructions.map(s => s.trim())
  return r
}

async function runEx() {
  const exDir = path.join(REPO, 'catalogue', 'exercises')
  if (!fs.existsSync(exDir)) die('Kansiota ' + exDir + ' ei löydy. Anna openGym-repon polku: --repo C:\\polku\\openGym')
  const all = fs.readdirSync(exDir).filter(f => f.endsWith('.json')).sort()
    .map(f => readJSON(path.join(exDir, f))).filter(e => e && !e.variantOf && e.name)
  const byId = Object.fromEntries(all.map(e => [e.id, e]))
  const de = readJSON(path.join(REPO, 'catalogue', 'i18n', 'de.json'), {})
  const sv = readJSON(path.join(REPO, 'catalogue', 'i18n', 'sv.json'), {})
  const outPath = path.join(REPO, 'catalogue', 'i18n', 'fi.json')
  const cachePath = path.join(WORK, 'liikkeet-cache.json')
  const done = { ...readJSON(outPath, {}), ...readJSON(cachePath, {}) }
  const complete = id => { const r = done[id]; return r && !checkEx(byId[id], r) }
  const todo = all.filter(e => !complete(e.id)).slice(0, LIMIT)
  console.log(`Liikepankki: ${all.length} liikettä, ${all.length - all.filter(e => !complete(e.id)).length} jo käännetty, nyt käännetään ${todo.length}.`)

  const size = e => e.name.length + (e.description || '').length + (e.instructions || []).join('').length
  const batches = chunk(todo, Number(opt('batch', 8)), 6000, size)
  const failed = new Map()
  let finished = 0
  const translate = async (batch, retry = false) => {
    const input = Object.fromEntries(batch.map(e => [e.id, {
      name: e.name, description: e.description, instructions: e.instructions,
      de: de[e.id]?.name, sv: sv[e.id]?.name,
    }]))
    const user = JSON.stringify(input, null, 1)
    if (DRY) { console.log('\n--- system ---\n' + EX_SYSTEM() + '\n--- user ---\n' + user); process.exit(0) }
    let out
    try { out = await chat(EX_SYSTEM(), user) } catch (e) { for (const x of batch) failed.set(x.id + ' ' + x.name, String(e.message || e)); return }
    const again = []
    for (const e of batch) {
      const fi = out[e.id]
      const err = checkEx(e, fi)
      if (!err) { done[e.id] = cleanEx(e, fi); failed.delete(e.id + ' ' + e.name) }
      else if (!retry) again.push(e); else failed.set(e.id + ' ' + e.name, err)
    }
    writeAtomic(cachePath, JSON.stringify(done))
    for (const e of again) await translate([e], true)
  }
  if (todo.length) {
    if (!MODEL) die('Mallia ei ole valittu. Anna --model <id> tai aseta OPENROUTER_MODEL. Katso tunnukset: node kaanna.mjs mallit')
    if (!KEY && !DRY) die('OPENROUTER_API_KEY puuttuu.')
    await pool(batches, CONC, async b => { await translate(b); finished += b.length; progress(finished, todo.length, failed.size) })
    console.log('')
  }
  // Samassa järjestyksessä ja muodossa kuin scripts/catalogue/import-names.mjs kirjoittaa.
  const rows = Object.keys(done).filter(id => byId[id]).sort().map(id => {
    const r = done[id]
    return [id, Object.fromEntries(['name', 'description', 'instructions'].filter(k => r[k] != null).map(k => [k, r[k]]))]
  })
  writeAtomic(outPath, JSON.stringify(Object.fromEntries(rows), null, 2) + '\n')
  console.log(`Kirjoitettu ${path.relative(REPO, outPath)}: ${rows.length}/${all.length} liikettä.`)
  // Sama nimi kahdella eri liikkeellä hämää hakua: listataan läpiluentaa varten.
  const seen = new Map(), dup = []
  for (const [id, r] of rows) { if (seen.has(r.name) && byId[seen.get(r.name)].name !== byId[id].name) dup.push(`${r.name}: ${seen.get(r.name)} (${byId[seen.get(r.name)].name}) / ${id} (${byId[id].name})`); else seen.set(r.name, id) }
  if (dup.length) { writeAtomic(path.join(WORK, 'samat-nimet.txt'), dup.join('\n') + '\n'); console.log(`${dup.length} suomenkielistä nimeä on käytössä kahdella eri liikkeellä: ${path.join(WORK, 'samat-nimet.txt')}`) }
  report(failed, 'liikkeet-virheet.txt')
}


// ---------------------------------------------------------------- sanaston oikoluku
async function runGlossary() {
  const g = readJSON(GLOSSARY_PATH, null)
  if (!g) die('Sanastoa ei löydy: ' + GLOSSARY_PATH)
  if (!MODEL) die('Mallia ei ole valittu. Anna --model <id> tai aseta OPENROUTER_MODEL.')
  if (!KEY) die('OPENROUTER_API_KEY puuttuu.')
  const terms = Object.fromEntries(Object.entries(g).filter(([k]) => !k.startsWith('_')))
  const system = `You are a Finnish strength-training coach and a professional Finnish software localizer. You review a glossary that will be used to translate a workout-tracking app (UI and an exercise library of 5,600 exercises) from English into Finnish.

For each English term check the proposed Finnish term: is it what Finnish gym-goers and Finnish fitness apps actually say, is it correct Finnish, is it unambiguous inside this glossary (two different English terms must not get the same Finnish word unless that is truly the Finnish usage, then say how to tell them apart), and is it short enough for buttons. Keep the format "term (short clarification)" where a clarification helps the translator. Fix what is wrong, keep what is right. You may add a few important missing terms (gym equipment, grips, positions, app concepts) that a translator of such an app would need.

Answer with only a JSON object: {"glossary": {"english term": "finnish term", ...}, "changes": ["short note in Finnish for every change or addition"]}`
  const out = await chat(system, JSON.stringify(terms, null, 1))
  if (!out.glossary || typeof out.glossary !== 'object') die('Malli ei palauttanut sanastoa: ' + JSON.stringify(out).slice(0, 300))
  const backup = GLOSSARY_PATH.replace(/\.json$/, '.ennen-oikolukua.json')
  if (!fs.existsSync(backup)) fs.copyFileSync(GLOSSARY_PATH, backup)
  const meta = Object.fromEntries(Object.entries(g).filter(([k]) => k.startsWith('_')))
  meta._oikoluettu = `${MODEL}, ${new Date().toISOString().slice(0, 10)}`
  writeAtomic(GLOSSARY_PATH, JSON.stringify({ ...meta, ...out.glossary }, null, 2) + '\n')
  console.log('Sanasto oikoluettu. Muutokset:')
  for (const c of out.changes || []) console.log('  - ' + c)
  for (const [k, v] of Object.entries(out.glossary)) if (terms[k] !== v) console.log(`  ${k}: ${terms[k] ?? '(uusi)'}  ->  ${v}`)
  console.log(`Vanha versio: ${backup}`)
}

// ---------------------------------------------------------------- kellot ja widgetit
const nativeMarks = s => [...String(s).matchAll(/%(\d\$)?(lld|ld|d|s|@)|\$\{\w+\}|\{\w+\}|\$\d\$/g)].map(m => m[0]).sort().join(' ')
const NATIVE_SYSTEM = () => `You translate the short texts of openGym's watch apps (Apple Watch, Wear OS, Garmin, Zepp OS) and iPhone home-screen widgets from English into Finnish. openGym is a free, open-source workout tracker.

Rules:
- Natural, idiomatic, short Finnish. Watch screens are tiny: keep every string as short as the English, shorter if you can.
- Address the user informally ("sinä" / imperative), friendly and plain like the English.
- Keep every placeholder exactly: %@, %lld, %d, %1$s, %1$d, %2$d, $1$ and {app}. Same ones, same count. You may move them. Do not add a case ending to a placeholder.
- Keep product names: openGym, iPhone, Apple Watch, Apple Health (Finnish UI name "Terveys" may be added in parentheses only if needed), Garmin, Garmin Connect, Zepp, Wear OS.
- Never use an em dash (—). Keep "…" where the English has it.
- "where" says which app the string is in. The German ("de") and Swedish ("sv") versions are hints for meaning only.
${glossaryText()}
You get {"id": {"en": "...", "de": "...", "sv": "...", "where": "..."}}. Answer with only a JSON object {"id": "Finnish"} with exactly the same ids.`

async function runNative() {
  const src = path.resolve(opt('lahde', path.join(HERE, 'natiivit-lahde.json')))
  const items = readJSON(src, null)
  if (!items) die('Lähdetiedostoa ei löydy: ' + src)
  const outPath = path.join(WORK, 'natiivit-fi.json')
  const done = readJSON(outPath, {})
  const todo = Object.keys(items).filter(k => !done[k]).slice(0, LIMIT)
  console.log(`Kellot ja widgetit: ${Object.keys(items).length} merkkijonoa, nyt käännetään ${todo.length}.`)
  if (!todo.length) return
  if (!MODEL) die('Mallia ei ole valittu. Anna --model <id> tai aseta OPENROUTER_MODEL.')
  if (!KEY && !DRY) die('OPENROUTER_API_KEY puuttuu.')
  const failed = new Map()
  const check = (k, fi, retry) => {
    const en = items[k].en
    if (typeof fi !== 'string' || !fi.trim()) return 'tyhjä'
    if (nativeMarks(en) !== nativeMarks(fi)) return `paikkamerkit (${nativeMarks(en) || '-'} vs ${nativeMarks(fi) || '-'})`
    if (fi.includes('—')) return 'ajatusviiva'
    if (en.includes('openGym') && !fi.includes('openGym')) return 'openGym puuttuu'
    const limit = Math.max(en.length, (items[k].de || '').length, (items[k].sv || '').length)
    if (!retry && en.length <= 30 && fi.length > Math.ceil(limit * 1.15) + 2) return 'liian pitkä'
    return null
  }
  const translate = async (batch, retry = false) => {
    const input = Object.fromEntries(batch.map((k, i) => [String(i + 1), items[k]]))
    let user = JSON.stringify(input, null, 1)
    if (retry) user = 'Keep it short: this is shown on a small watch screen.\n' + user
    if (DRY) { console.log('\n--- system ---\n' + NATIVE_SYSTEM() + '\n--- user ---\n' + user); process.exit(0) }
    let out
    try { out = await chat(NATIVE_SYSTEM(), user) } catch (e) { for (const k of batch) failed.set(k, String(e.message || e)); return }
    const again = []
    batch.forEach((k, i) => {
      const fi = out[String(i + 1)]
      const err = check(k, fi, retry)
      if (!err) { done[k] = fi.trim(); failed.delete(k) } else if (!retry) again.push(k); else failed.set(k, err + ' -> ' + JSON.stringify(fi))
    })
    writeAtomic(outPath, JSON.stringify(done, null, 1) + '\n')
    for (const k of again) await translate([k], true)
  }
  const batches = chunk(todo, 40, 6000, k => items[k].en.length * 3)
  let finished = 0
  await pool(batches, CONC, async b => { await translate(b); finished += b.length; progress(finished, todo.length, failed.size) })
  console.log(`\nKirjoitettu ${outPath}: ${Object.keys(done).length}/${Object.keys(items).length}.`)
  report(failed, 'natiivit-virheet.txt')
}

// ---------------------------------------------------------------- läpiluku
function csv(rows) {
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"'
  // BOM + puolipiste: suomenkielinen Excel avaa tämän suoraan oikein.
  return '\uFEFF' + rows.map(r => r.map(q).join(';')).join('\r\n') + '\r\n'
}
async function runReview() {
  const uiPath = path.join(REPO, 'frontend', 'src', 'locales', 'fi.js')
  if (fs.existsSync(uiPath)) {
    const fi = await importDefault(uiPath)
    const long = readJSON(path.join(WORK, 'ui-pitkat.json'), {})
    const rows = [['englanti', 'suomi', 'huomio']]
    for (const [en, v] of Object.entries(fi)) {
      const note = v === en && /[a-z]{4}/i.test(en) ? 'sama kuin englanniksi'
        : long[en] === v ? 'pitkä kapeaan paikkaan' : v.length > en.length * 1.8 && en.length > 8 ? 'paljon pidempi' : ''
      rows.push([en, v, note])
    }
    writeAtomic(path.join(WORK, 'tarkistus-ui.csv'), csv(rows))
    console.log('Kirjoitettu ' + path.join(WORK, 'tarkistus-ui.csv'))
  }
  const exPath = path.join(REPO, 'catalogue', 'i18n', 'fi.json')
  if (fs.existsSync(exPath)) {
    const fi = readJSON(exPath, {})
    const rows = [['id', 'englanniksi', 'suomeksi', 'kuvaus suomeksi']]
    for (const [id, r] of Object.entries(fi)) {
      const e = readJSON(path.join(REPO, 'catalogue', 'exercises', id + '.json'), {})
      rows.push([id, e.name, r.name, r.description])
    }
    writeAtomic(path.join(WORK, 'tarkistus-liikkeet.csv'), csv(rows))
    console.log('Kirjoitettu ' + path.join(WORK, 'tarkistus-liikkeet.csv'))
  }
}

// ---------------------------------------------------------------- mallit
async function runModels() {
  const res = await fetch('https://openrouter.ai/api/v1/models')
  const { data } = await res.json()
  const rows = data.filter(m => m.id.startsWith('google/')).sort((a, b) => a.id.localeCompare(b.id))
  for (const m of rows) {
    const p = m.pricing || {}
    const per = v => v ? (Number(v) * 1e6).toFixed(2) + ' $' : '?'
    console.log(`${m.id.padEnd(46)} sisään ${per(p.prompt)}/Mt  ulos ${per(p.completion)}/Mt  ${m.name}`)
  }
}

// ----------------------------------------------------------------
const run = { ui: runUi, liikkeet: runEx, tarkistus: runReview, mallit: runModels, sanasto: runGlossary, natiivit: runNative }[cmd]
if (!run) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 24).map(l => l.replace(/^\/\/ ?/, '')).join('\n'))
  process.exit(cmd ? 1 : 0)
}
const t0 = Date.now()
await run()
if (tokIn) console.log(`Valmis ${((Date.now() - t0) / 60000).toFixed(1)} minuutissa. Tokenit: ${tokIn} sisään, ${tokOut} ulos${spent ? ', hinta ' + spent.toFixed(3) + ' $' : ''}.`)
