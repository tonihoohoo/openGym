# openGym suomeksi: ohjeet Windowsille

Tämä kansio sisältää kaiken, mitä tarvitset käännöksen ajamiseen omalla koneellasi:

| Tiedosto | Mitä se on |
|---|---|
| `kaanna.mjs` | Käännösskripti (Node, ei riippuvuuksia). Kääntää käyttöliittymän ja liikepankin OpenRouterin kautta. |
| `sanasto.json` | Termisanasto, jonka skripti antaa mallille. **Ehdotus: lue ja muokkaa ennen ajoa.** |
| `0001-Finnish-register-the-fi-locale.patch` | Muutos, joka lisää suomen kielivalikkoon (on myös forkin `suomi`-haarassa). |

## Mitä käännetään

| Osa | Lähde | Tulos | Määrä |
|---|---|---|---|
| Käyttöliittymä | `frontend/src/locales/*.js` (avaimet ovat englanninkielisiä lauseita) | `frontend/src/locales/fi.js` | 5 829 merkkijonoa, n. 195 000 merkkiä |
| Liikepankki | `catalogue/exercises/<id>.json` (nimi, kuvaus, vaiheet) | `catalogue/i18n/fi.json` | 5 632 liikettä, n. 2,35 milj. merkkiä |

Nämä tulevat mukaan automaattisesti, kun yllä olevat ovat valmiit (ajan generoinnin itse pilvessä):
liikkeiden nimi-, ohje- ja kuvauspaketit sovellukselle, push-ilmoitukset (treenimuistutus,
mittausmuistutus, vuosikooste, valmentajailmoitukset) ja Coachin liikekirjasto.

Kellosovellukset (Apple Watch, Wear OS, Garmin, Zepp) ottavat suurimman osan sanoistaan
puhelimen paketista, mutta niillä on lisäksi noin sata omaa lausetta. Ne kannattaa tehdä
omana, pienenä jatko-PR:nään.

## 1. Asenna Git ja Node (kerran)

Avaa PowerShell ja aja:

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
```

Sulje ja avaa PowerShell uudelleen, ja tarkista: `node --version` (pitää olla 20 tai uudempi).

## 2. Hae forkki koneelle

```powershell
cd C:\
mkdir koodi; cd koodi
git clone https://github.com/tonihoohoo/openGym.git
cd openGym
git checkout suomi
```

Repo on iso (n. 23 000 tiedostoa, kuvat ja videot mukana), joten kloonaus kestää hetken.

Kopioi tämän kansion `kaanna.mjs` ja `sanasto.json` vaikkapa kansioon `C:\opengym-fi\`
(ei repon sisään, jotta ne eivät päädy PR:ään).

## 3. API-avain ja malli

Samassa PowerShell-ikkunassa (avain on voimassa vain tämän ikkunan ajan, eikä tallennu mihinkään):

```powershell
$env:OPENROUTER_API_KEY = "sk-or-v1-..."
cd C:\opengym-fi
node kaanna.mjs mallit
```

`mallit` listaa OpenRouterin Google-mallit hintoineen. Kopioi haluamasi mallin tunnus
(esim. `google/gemini-...`) ja aseta se:

```powershell
$env:OPENROUTER_MODEL = "google/<mallin-tunnus>"
```

## 4. Koeajo ensin

```powershell
node kaanna.mjs ui --repo C:\koodi\openGym --limit 60
node kaanna.mjs liikkeet --repo C:\koodi\openGym --limit 16
```

Avaa `C:\koodi\openGym\frontend\src\locales\fi.js` ja `C:\koodi\openGym\catalogue\i18n\fi.json`
ja katso, miltä jälki näyttää. Jos termit menevät väärin, korjaa `sanasto.json`. Jos haluat
kokeilla uudelleen alusta, poista `C:\opengym-fi\tyo\` sekä nuo kaksi fi-tiedostoa.

`--kuiva` näyttää, mitä mallille lähetettäisiin, lähettämättä mitään.

## 5. Koko käännös

```powershell
node kaanna.mjs ui --repo C:\koodi\openGym
node kaanna.mjs liikkeet --repo C:\koodi\openGym
```

- Skripti näyttää etenemisen, tokenit ja hinnan dollareina.
- Työ tallentuu jokaisen erän jälkeen. Jos ajo katkeaa (Ctrl+C, verkko, saldo), sama komento
  jatkaa siitä mihin jäätiin.
- Karkea koko: käyttöliittymä n. 0,2 milj. tokenia sisään ja 0,1 milj. ulos, liikepankki n.
  1,1 milj. sisään ja 1 milj. ulos. Kerro nämä `mallit`-listan hinnoilla, niin saat arvion.
  "Ajattelevat" mallit käyttävät lisäksi ajattelutokeneita.
- `--rinnakkain 8` nopeuttaa, jos OpenRouter ei ala hidastella (oletus 4).

### Mitä skripti tarkistaa automaattisesti

- Paikkamerkit `{0}`, `{1}` säilyvät täsmälleen (muuten luku katoaisi lauseesta).
- Ei tyhjiä käännöksiä, ei ajatusviivoja (projektin tyylisääntö), `openGym` ja `http(s)://` säilyvät.
- **Pituus:** lyhyt teksti (nappi, välilehti, otsikko, alle 30 merkkiä) saa olla korkeintaan noin
  pisimmän nykyisen kielen (saksa, unkari, ruotsi...) mittainen. Liian pitkä käännetään
  automaattisesti uudelleen lyhyemmäksi pyytäen. Jos se on yhä pitkä, se hyväksytään mutta
  merkitään läpiluettavaksi.
- Liikkeissä vaiheiden määrä on sama kuin englanniksi, ja nimet tallennetaan pienellä kuten
  muissakin kielissä.
- Epäonnistuneet jäävät listaan (`tyo\ui-virheet.txt`, `tyo\liikkeet-virheet.txt`) ja yritetään
  uudelleen, kun ajat komennon uudestaan. Jos sama suomenkielinen nimi tuli kahdelle eri
  liikkeelle, ne listataan tiedostoon `tyo\samat-nimet.txt`.

## 6. Läpiluku

```powershell
node kaanna.mjs tarkistus --repo C:\koodi\openGym
```

Tämä tekee Exceliin aukeavat tiedostot `tyo\tarkistus-ui.csv` ja `tyo\tarkistus-liikkeet.csv`.
Sarake *huomio* nostaa esiin kohdat, jotka kannattaa katsoa ensin (pitkä kapeaan paikkaan,
sama kuin englanniksi, paljon pidempi). Korjaukset tehdään suoraan tiedostoihin `fi.js` ja
`fi.json` (esim. VS Codella). Skripti ei käännä jo käännettyä uudelleen, joten korjauksesi säilyvät.

**Tärkeää upstream-PR:ää varten:** openGymin ohjeissa sanotaan, ettei konekäännöstä saa liittää
lukematta. PR:ssä kerrotaan avoimesti, että käännös on tehty Geminillä ja sinä olet äidinkielisenä
lukenut sen läpi. Käyttöliittymä ja liikkeiden nimet kannattaa lukea kokonaan; liikkeiden ohjeet
ja kuvaukset (yli 2 miljoonaa merkkiä) voi lukea otoksina.

## 7. Lähetä takaisin

```powershell
cd C:\koodi\openGym
git add frontend/src/locales/fi.js catalogue/i18n/fi.json
git commit -m "Finnish: UI strings and exercise catalogue"
git push
```

Kerro sitten minulle. Generoin loput tiedostot, ajan testit ja avaan PR:n.

## Myöhemmin: uudet merkkijonot

Kun upstream lisää sovellukseen uusia tekstejä, hae muutokset ja aja sama `ui`-komento: se
kääntää vain uudet.
