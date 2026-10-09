// Lanceur de l'Atelier marketing (Windows) : un vrai .exe, sans fenêtre noire.
//  1. démarre le serveur local en arrière-plan (s'il ne tourne pas déjà) ;
//  2. ouvre l'atelier dans sa propre fenêtre d'application (Edge ou Chrome en mode « application », profil dédié) ;
//  3. à la fermeture de cette fenêtre, arrête le serveur — après avoir prévenu si un export est en cours.
// Compilé avec le compilateur fourni par Windows (csc.exe) : voir Construire-exe.bat. Pas de dépendance à installer.
// Variables facultatives : ATELIER_PORT (défaut 3000), ATELIER_PROFILE (dossier du profil de la fenêtre). ATELIER_DATA est transmis au serveur.
using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Reflection;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("Atelier marketing")]
[assembly: AssemblyProduct("Atelier marketing")]
[assembly: AssemblyDescription("Atelier marketing — lanceur")]

static class Atelier
{
    const string Titre = "Atelier marketing";

    [STAThread]
    static int Main()
    {
        string racine = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
        string portEnv = Environment.GetEnvironmentVariable("ATELIER_PORT");
        int port = 3000;
        if (!string.IsNullOrEmpty(portEnv)) int.TryParse(portEnv, out port);
        string url = "http://127.0.0.1:" + port + "/";

        Process serveur = null;
        bool proprietaire = false;
        if (!Repond(url))
        {
            string node = TrouverNode(racine);
            if (node == null)
            {
                Message("Node.js est introuvable.\n\nPlacez node.exe dans le dossier « tools\\node » de l'atelier, ou installez Node.js (nodejs.org).", MessageBoxIcon.Error);
                return 1;
            }
            string journal = Path.Combine(racine, "data", "atelier.log");
            Directory.CreateDirectory(Path.GetDirectoryName(journal));
            ProcessStartInfo psi = new ProcessStartInfo("cmd.exe",
                "/c \"\"" + node + "\" --disable-warning=ExperimentalWarning src\\server.js >> \"" + journal + "\" 2>&1\"");
            psi.WorkingDirectory = racine;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.EnvironmentVariables["PORT"] = port.ToString();
            serveur = Process.Start(psi);
            proprietaire = true;

            DateTime limite = DateTime.Now.AddSeconds(40);
            while (!Repond(url))
            {
                if (serveur.HasExited || DateTime.Now > limite)
                {
                    Message("L'atelier n'a pas pu démarrer.\n\nLe détail est dans :\n" + journal + "\n\n(Le port " + port + " est peut-être déjà utilisé par un autre programme.)", MessageBoxIcon.Error);
                    Arreter(serveur);
                    return 1;
                }
                Thread.Sleep(300);
            }
        }

        string navigateur = TrouverNavigateur();
        if (navigateur == null)
        {
            Message("Ni Microsoft Edge ni Google Chrome n'ont été trouvés : impossible d'ouvrir la fenêtre de l'atelier.\nL'atelier reste accessible dans un navigateur à l'adresse " + url, MessageBoxIcon.Warning);
            Arreter(serveur);
            return 1;
        }

        string profil = Environment.GetEnvironmentVariable("ATELIER_PROFILE");
        if (string.IsNullOrEmpty(profil))
            profil = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), Titre, "profil");
        Directory.CreateDirectory(profil);
        string args = "--app=" + url + " --user-data-dir=\"" + profil + "\" --no-first-run --no-default-browser-check --window-size=1400,950";

        // Une autre fenêtre de l'atelier est déjà ouverte (serveur lancé par ailleurs) : on ouvre simplement une fenêtre de plus.
        if (!proprietaire)
        {
            Process.Start(navigateur, args);
            return 0;
        }

        while (true)
        {
            Process fenetre = Process.Start(navigateur, args);
            fenetre.WaitForExit();
            int occupe = Occupe(url);
            if (occupe > 0)
            {
                DialogResult r = MessageBox.Show(
                    occupe + " export(s) vidéo en cours.\n\nQuitter maintenant les interrompt (vous pourrez les relancer).\n\nQuitter quand même ?",
                    Titre, MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
                if (r == DialogResult.No) continue; // on rouvre la fenêtre
            }
            break;
        }
        Arreter(serveur);
        return 0;
    }

    static bool Repond(string url)
    {
        try
        {
            HttpWebRequest rq = (HttpWebRequest)WebRequest.Create(url + "health");
            rq.Timeout = 1500;
            using (HttpWebResponse rp = (HttpWebResponse)rq.GetResponse())
            using (StreamReader sr = new StreamReader(rp.GetResponseStream()))
                return sr.ReadToEnd().Contains("\"ok\":true");
        }
        catch { return false; }
    }

    static int Occupe(string url)
    {
        try
        {
            HttpWebRequest rq = (HttpWebRequest)WebRequest.Create(url + "health");
            rq.Timeout = 1500;
            using (HttpWebResponse rp = (HttpWebResponse)rq.GetResponse())
            using (StreamReader sr = new StreamReader(rp.GetResponseStream()))
            {
                Match m = Regex.Match(sr.ReadToEnd(), "\"busy\":(\\d+)");
                return m.Success ? int.Parse(m.Groups[1].Value) : 0;
            }
        }
        catch { return 0; }
    }

    static void Arreter(Process p)
    {
        if (p == null) return;
        try
        {
            // cmd.exe a lancé node : on arrête toute l'arborescence
            ProcessStartInfo psi = new ProcessStartInfo("taskkill", "/T /F /PID " + p.Id);
            psi.CreateNoWindow = true;
            psi.UseShellExecute = false;
            Process.Start(psi).WaitForExit(5000);
        }
        catch { }
    }

    static string TrouverNode(string racine)
    {
        string local = Path.Combine(racine, "tools", "node", "node.exe");
        if (File.Exists(local)) return local;
        string path = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (string dossier in path.Split(';'))
        {
            try
            {
                string f = Path.Combine(dossier.Trim(), "node.exe");
                if (File.Exists(f)) return f;
            }
            catch { }
        }
        string pf = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe");
        return File.Exists(pf) ? pf : null;
    }

    static string TrouverNavigateur()
    {
        string pf86 = Environment.GetEnvironmentVariable("ProgramFiles(x86)") ?? "";
        string pf = Environment.GetEnvironmentVariable("ProgramFiles") ?? "";
        string[] candidats = new string[] {
            Path.Combine(pf86, "Microsoft", "Edge", "Application", "msedge.exe"),
            Path.Combine(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
            Path.Combine(pf, "Google", "Chrome", "Application", "chrome.exe"),
            Path.Combine(pf86, "Google", "Chrome", "Application", "chrome.exe")
        };
        foreach (string c in candidats) if (File.Exists(c)) return c;
        return null;
    }

    static void Message(string texte, MessageBoxIcon icone)
    {
        MessageBox.Show(texte, Titre, MessageBoxButtons.OK, icone);
    }
}
