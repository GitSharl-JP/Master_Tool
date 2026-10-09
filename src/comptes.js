// Outil local, à lancer dans un terminal sur cet ordinateur (jamais exposé par le serveur web).
//   node src/comptes.js                 → liste les noms d'utilisateur (jamais les mots de passe, qui ne sont pas lisibles)
//   node src/comptes.js reset <nom>     → choisit un nouveau mot de passe pour ce compte (10 caractères minimum)
import { createInterface } from 'node:readline/promises';
import { listUsers, setPassword } from './db.js';

const [cmd, name] = process.argv.slice(2);
const users = listUsers();
if (cmd !== 'reset') {
  console.log(users.length ? 'Comptes existants :\n' + users.map((u) => `  - ${u.name}`).join('\n') : 'Aucun compte : ouvrez l’atelier, il propose d’en créer un.');
  console.log('\nMot de passe oublié ?  node src/comptes.js reset <nom>');
} else {
  if (!users.some((u) => u.name === name)) { console.log(`Aucun compte « ${name || ''} ». Comptes : ${users.map((u) => u.name).join(', ') || 'aucun'}`); process.exit(1); }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const pw = (await rl.question(`Nouveau mot de passe pour ${name} (10 caractères minimum, il s’affichera à l’écran) : `)).trim();
  rl.close();
  if (pw.length < 10) { console.log('Trop court : rien n’a été changé.'); process.exit(1); }
  console.log(setPassword(name, pw) ? 'Mot de passe changé. Vous pouvez vous connecter.' : 'Échec.');
}
