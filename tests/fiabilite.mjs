// Tests rapides de fiabilité des données (sans navigateur ni ffmpeg) : textes figés, import de rapports Meta.
// Données dans un dossier temporaire : `node tests/fiabilite.mjs`.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ATELIER_DATA = mkdtempSync(join(tmpdir(), 'atelier-fiab-'));
const { createTestEdition } = await import('../src/projects.js');
const C = await import('../src/campaigns.js');
const M = await import('../src/metaimport.js');

let ok = 0, ko = 0;
const check = (name, cond, detail = '') => { if (cond) ok++; else { ko++; console.log('ÉCHEC :', name, detail); } };

const pid = createTestEdition('test');
const camp = C.createCampaign(pid, { name: 'Camp' }, 'test').id;
const s1 = (C.createAdset(camp, { name: 'Ensemble A' }, 'test'), C.listAdsets(camp)[0].id);
const s2 = (C.createAdset(camp, { name: 'Ensemble B' }, 'test'), C.listAdsets(camp)[1].id);
C.createAd(s1, { name: 'Annonce commune' }, 'test');
C.createAd(s2, { name: 'Annonce commune' }, 'test');
C.createAd(s2, { name: 'Annonce unique' }, 'test');
C.createAd(s1, { name: 'Annonce texte' }, 'test');
const [adA, adB, adU, adT] = [C.listAds(s1)[0], C.listAds(s2)[0], C.listAds(s2)[1], C.listAds(s1)[1]];

// --- F04 : un texte publié reste figé
const t = C.createContent(pid, { title: 'Légende', body: 'Texte original', language: 'EN' }, 'test').id;
C.updateContent(t, { ...C.getContent(t), status: 'approuvé' }, 'test');
check('F04 association de texte', C.linkContent(t, { ad_id: adT.id }, 'test').ok);
let link = C.linksOfContent(t)[0];
check('F04 une version de texte est épinglée', !!link.text_version_id);
let r = C.transitionRecap(link.id, 'approuvé');
check('F04 approuvé sans erreur', r.errors.length === 0, JSON.stringify(r.errors));
C.setLinkState(link.id, 'approuvé', 'test');
r = C.transitionRecap(link.id, 'transmis');
check('F04 le récapitulatif contient l’identité de la version', !!r.recap.version_texte && !!r.recap.empreinte_texte);
check('F04 transmis', C.setLinkState(link.id, 'transmis', 'test', r.hash).ok);
r = C.transitionRecap(link.id, 'publié');
check('F04 publié', C.setLinkState(link.id, 'publié', 'test', r.hash).ok);
C.updateContent(t, { ...C.getContent(t), body: 'Texte MODIFIÉ après publication' }, 'test');
link = C.getLink(link.id);
check('F04 le texte publié est intact après modification', C.linkedText(link).body === 'Texte original', C.linkedText(link).body);
check('F04 la modification est signalée (version non courante)', C.linkedText(link).current === false);
check('F04 on peut associer la version actuelle sans toucher à l’ancienne', C.linkContent(t, { ad_id: adT.id }, 'test').ok && C.linksOfContent(t).length === 2);
check('F04 deux versions conservées', C.textVersionsOf(t).length === 2);
// ancien lien sans version
C.linkContent(t, { campaign_id: camp }, 'test');
const old = C.linksOfContent(t).find((l) => l.campaign_id === camp);
(await import('../src/db.js')).db.prepare('UPDATE content_links SET text_version_id=NULL WHERE id=?').run(old.id);
check('F04 lien ancien : marqué « historique non garanti »', C.linkedText(C.getLink(old.id)).historical === true);

// --- F05 : nombres
check('F05 « 1 234,56 » = 1234.56', M.parseNumber('1 234,56') === 1234.56);
check('F05 « 1,234.56 » = 1234.56', M.parseNumber('1,234.56') === 1234.56);
check('F05 « 12.345 » est ambigu (pas converti en silence)', M.parseNumber('12.345', { dec: '.' }) === 12.345 && M.parseNumber('12.345', { dec: ',' }) === 12345);
check('F05 valeur illisible = null, pas zéro', M.parseNumber('abc') === null);
check('F05 ambiguïté détectée', M.isAmbiguousNumber('12.345') && M.isAmbiguousNumber('1,234') && !M.isAmbiguousNumber('1 234,56') && !M.isAmbiguousNumber('12,5'));

// --- F02 : annonces homonymes
const head = 'Nom de la publicité;Début des rapports;Fin des rapports;Impressions;Clics sur un lien;Montant dépensé (EUR);Résultats';
for (const a of [adA, adB, adU]) {
  for (const [lid] of [[a.id]]) {
    const c = C.createContent(pid, { title: 'C-' + a.id, body: 'x' }, 'test').id;
    C.updateContent(c, { ...C.getContent(c), status: 'approuvé' }, 'test');
    C.linkContent(c, { ad_id: a.id }, 'test');
  }
}
let p = M.previewImport(camp, `${head}\nAnnonce commune;2027-01-01;2027-01-07;100;5;10,00;1`);
check('F02 homonyme : la ligne est en attente (pas de rattachement silencieux)', !p.rows[0].linkId && p.rows[0].choices?.length === 2, JSON.stringify(p.rows[0]));
check('F02 homonyme : raison indiquée', /plusieurs/.test(p.rows[0].skip || ''));
p = M.previewImport(camp, `${head}\nannonce  UNIQUE;2027-01-01;2027-01-07;100;5;10,00;1`);
check('F02 nom unique (casse/espaces différents) : rattaché', !!p.rows[0].linkId && /nom unique/i.test(p.rows[0].reason || ''), JSON.stringify(p.rows[0]));
// choix explicite d'une homonyme
const choose = C.allLinksOfCampaign(camp).find((l) => l.ad_id === adB.id).id;
p = M.previewImport(camp, `${head}\nAnnonce commune;2027-01-01;2027-01-07;100;5;10,00;1`, { 0: choose });
check('F02 choix explicite : rattaché à l’annonce choisie', p.rows[0].linkId === choose, JSON.stringify(p.rows[0]));
// identifiant Meta prioritaire
C.updateAdCopy(adA.id, { name: 'Annonce commune', meta_id: '9001' }, 'test');
p = M.previewImport(camp, `Nom de la publicité;ID de la publicité;Début des rapports;Fin des rapports;Impressions;Clics sur un lien;Montant dépensé (EUR);Résultats\nAnnonce commune;9001;2027-01-01;2027-01-07;100;5;10,00;1`);
const idA = C.allLinksOfCampaign(camp).find((l) => l.ad_id === adA.id).id;
check('F02 l’ID Meta de l’annonce est prioritaire', p.rows[0].linkId === idA && /identifiant/i.test(p.rows[0].reason || ''), JSON.stringify(p.rows[0]));

// --- F03 : rapport corrigé / chevauchement
const lk = C.allLinksOfCampaign(camp).find((l) => l.ad_id === adU.id).id;
const rep = (extra) => M.previewImport(camp, `${head}\nAnnonce unique;2027-02-01;2027-02-07;${extra}`);
let a = rep('100;5;10,00;1');
check('F03 première ligne importable', !!a.rows[0].linkId && !a.rows[0].skip, JSON.stringify(a.rows[0]));
check('F03 import 1', M.applyImport(camp, a.rows, 'test').added === 1);
a = rep('100;5;10,00;1');
check('F03 même rapport : « déjà enregistré »', a.rows[0].skip === 'déjà enregistré');
check('F03 même rapport : aucun doublon à l’application', M.applyImport(camp, a.rows.map((x) => ({ ...x, skip: undefined })), 'test').added === 0);
a = rep('120;6;12,00;1');
check('F03 rapport corrigé : conflit détecté, pas d’addition', a.rows[0].conflict?.length === 1 && !a.rows[0].skip?.startsWith('déjà'), JSON.stringify(a.rows[0]));
check('F03 conflit non appliqué sans choix', M.applyImport(camp, a.rows, 'test').added === 0);
let o = M.applyImport(camp, a.rows.map((x) => ({ ...x, replace: true })), 'test');
check('F03 remplacement explicite', o.replaced === 1 && o.added === 0, JSON.stringify(o));
const cmp = C.compare(camp).find((x) => x.title === 'C-' + adU.id);
check('F03 total = valeurs du rapport corrigé (120 / 12), pas 220 / 22', cmp.imp === 120 && Math.abs(cmp.spend - 12) < 0.001, JSON.stringify(cmp));
check('F03 l’ancienne mesure est conservée (remplacée, non supprimée)', (await import('../src/db.js')).db.prepare('SELECT COUNT(*) c FROM results WHERE link_id=? AND superseded_by IS NOT NULL').get(lk).c === 1);
// période qui chevauche
a = M.previewImport(camp, `${head}\nAnnonce unique;2027-02-05;2027-02-12;10;1;1,00;0`);
check('F03 période chevauchante : signalée', a.rows[0].conflict?.length === 1, JSON.stringify(a.rows[0]));
// colonnes absentes
a = M.previewImport(camp, `Nom de la publicité;Début des rapports;Fin des rapports;Impressions\nAnnonce unique;2027-03-01;2027-03-07;50`);
check('F03 colonne dépense absente : inconnu, pas zéro', a.rows[0].spend === null && a.rows[0].clicks === null, JSON.stringify(a.rows[0]));
a = M.previewImport(camp, `${head}\nAnnonce unique;2027-03-01;2027-03-07;50;3;abc;1`);
check('F03 valeur illisible : ligne signalée', /illisible/i.test(a.rows[0].warn || ''), JSON.stringify(a.rows[0]));

console.log(`${ok} contrôles réussis, ${ko} en échec.`);
process.exit(ko ? 1 : 0);
