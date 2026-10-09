// « À faire maintenant » : les prochaines actions utiles d'un projet, dans l'ordre, calculées depuis l'état réel.
// Pensé pour une personne seule avec peu de temps : on ouvre le projet, on voit quoi faire, on clique.
import { getEdition } from './db.js';
import { posterBlockers } from './schema.js';
import { getDesign } from './studio.js';
import * as plan from './plan.js';
import * as campaigns from './campaigns.js';
import * as variants from './variants.js';
import { backupStatus } from './backup.js';
import { FORMATS } from './formats.js';

const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export function nextActions(pid, limit = 8) {
  const ed = getEdition(pid), out = [], today = plan.today();
  const push = (level, text, href) => out.push({ level, text, href });

  // 1. calendrier : en retard ou dans les 7 jours
  for (const it of plan.listItems(pid, { to: addDays(today, 7) })) {
    if (it.status === 'fait') continue;
    const late = it.due_date < today;
    push(late ? 'urgent' : 'normal', `${late ? 'En retard' : 'À faire'} (${it.due_date}) : ${it.title}`, it.variant_id ? `/edition/${pid}/variants/${it.variant_id}` : `/edition/${pid}/calendar`);
  }
  // 2. variantes : l'étape suivante de chacune
  for (const v of variants.listVariants(pid)) {
    const ns = variants.nextStep(v.id);
    if (!ns || /^Terminé/.test(ns.text) || (!ns.action && !ns.href && /Utilisables tels quels/.test(ns.text))) continue;
    push('normal', `« ${v.name} » — ${ns.text}`, ns.href || `/edition/${pid}/variants/${v.id}`);
  }
  // 3. couverture : formats manquants selon les placements souhaités des ensembles
  for (const c of campaigns.listCampaigns(pid)) {
    for (const s of campaigns.listAdsets(c.id)) {
      const cov = campaigns.coverage(s, campaigns.linksFor('adset_id', s.id));
      const pending = variants.listVariants(pid, c.id).filter((v) => v.status !== 'archivé').flatMap((v) => v.formats);
      const miss = cov.missing.filter((f) => !pending.includes(f));
      if (miss.length) push('normal', `Campagne « ${c.name} », ensemble « ${s.name} » : il manque ${miss.map((f) => FORMATS[f].ratio).join(', ')}`, `/edition/${pid}/variants/new?campaign=${c.id}&adset=${s.id}&formats=${miss.join(',')}`);
    }
  }
  // 4. fiche et sauvegarde
  const notReady = posterBlockers(ed, [['4x5', getDesign(pid, 'poster_4x5')]]);
  if (notReady.length) push('normal', `Pour sortir vos affiches du BROUILLON, complétez les infos du spectacle (${notReady.length} point(s))`, `/edition/${pid}/settings`);
  const bs = backupStatus();
  if (bs.stale) push('normal', bs.dir ? 'Aucune sauvegarde externe depuis plus de 7 jours.' : 'Aucun dossier de sauvegarde externe : un seul disque détient tout votre travail.', '/settings#sauvegardes');
  out.sort((a, b) => (a.level === 'urgent' ? 0 : 1) - (b.level === 'urgent' ? 0 : 1));
  return out.slice(0, limit);
}
