// Installateur / désinstalleur de l'Atelier marketing (Windows), compilé avec le csc.exe fourni par Windows.
// Deux exécutables sortent de CE fichier :
//   Setup (avec l'application embarquée)           → installe, crée les raccourcis, s'enregistre dans « Applications installées » ;
//   Desinstaller (compilé avec /define:UNINSTALLER) → désinstalle ; copié dans le dossier d'installation par Setup.
// Installation pour l'utilisateur courant : aucun droit administrateur. Les données (dossier data\) ne sont JAMAIS écrasées
// par une mise à jour, et ne sont supprimées à la désinstallation que sur demande expresse.
// Options (utiles aux tests et au déploiement) : /silent  /dir=CHEMIN  /nodesktop  /nolaunch  /purge (désinstallation : supprime aussi les données)
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Windows.Forms;
using Microsoft.Win32;

static class Programme
{
    public const string Nom = "Atelier marketing";
    const string CleDesinstall = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\AtelierMarketing";
    static bool silencieux, sansBureau, sansLancement, purge;
    static string dossierDemande;

    static string DossierParDefaut()
    {
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", Nom);
    }
    static string ProgrammesMenuDemarrer()
    {
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), Nom);
    }

    [STAThread]
    static int Main(string[] args)
    {
        foreach (string a in args)
        {
            string l = a.ToLowerInvariant();
            if (l == "/silent" || l == "/s") silencieux = true;
            else if (l == "/nodesktop") sansBureau = true;
            else if (l == "/nolaunch") sansLancement = true;
            else if (l == "/purge") purge = true;
            else if (l.StartsWith("/dir=")) dossierDemande = a.Substring(5).Trim('"');
        }
        Application.EnableVisualStyles();
#if UNINSTALLER
        return Desinstaller(args);
#else
        return Installer();
#endif
    }

    static void Info(string texte, MessageBoxIcon icone)
    {
        if (!silencieux) MessageBox.Show(texte, Nom, MessageBoxButtons.OK, icone);
        else Console.Error.WriteLine(texte);
    }

    // ------------------------------------------------------------------ processus de l'atelier en cours dans ce dossier
    static Process[] EnCours(string dossier)
    {
        System.Collections.Generic.List<Process> liste = new System.Collections.Generic.List<Process>();
        string prefixe = Path.GetFullPath(dossier).TrimEnd('\\') + "\\";
        foreach (Process p in Process.GetProcesses())
        {
            try
            {
                string f = p.MainModule.FileName;
                if (f.StartsWith(prefixe, StringComparison.OrdinalIgnoreCase)) liste.Add(p);
            }
            catch { }
        }
        return liste.ToArray();
    }

    // ------------------------------------------------------------------ raccourcis et enregistrement
    static void Raccourci(string lnk, string cible, string dossier, string description)
    {
        Type t = Type.GetTypeFromProgID("WScript.Shell");
        dynamic sh = Activator.CreateInstance(t);
        dynamic l = sh.CreateShortcut(lnk);
        l.TargetPath = cible;
        l.WorkingDirectory = dossier;
        l.IconLocation = cible + ",0";
        l.Description = description;
        l.Save();
    }
    static string LienBureau() { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), Nom + ".lnk"); }

    static long TailleDossier(string d)
    {
        long n = 0;
        foreach (string f in Directory.GetFiles(d, "*", SearchOption.AllDirectories)) { try { n += new FileInfo(f).Length; } catch { } }
        return n;
    }

#if !UNINSTALLER
    // ================================================================== INSTALLATION
    static int Installer()
    {
        string dossier = dossierDemande ?? DossierParDefaut();
        if (silencieux)
        {
            string erreur = Installation(dossier, !sansBureau, null);
            if (erreur != null) { Info(erreur, MessageBoxIcon.Error); return 1; }
            if (!sansLancement) Lancer(dossier);
            return 0;
        }
        return Fenetre(dossier) ? 0 : 1;
    }

    static void Lancer(string dossier)
    {
        try { Process.Start(new ProcessStartInfo(Path.Combine(dossier, "Atelier.exe")) { WorkingDirectory = dossier }); } catch { }
    }

    // Retourne null si tout va bien, sinon le message d'erreur à montrer.
    static string Installation(string dossier, bool bureau, Action<int, string> progres)
    {
        if (progres == null) progres = delegate { };
        try
        {
            Directory.CreateDirectory(dossier);
            Process[] actifs = EnCours(dossier);
            if (actifs.Length > 0)
                return "L'Atelier marketing est ouvert. Fermez sa fenêtre (puis relancez l'installation) pour pouvoir le mettre à jour.";

            // mise à jour : on remplace le programme, jamais les données
            foreach (string sous in new string[] { "src", "public" })
            {
                string d = Path.Combine(dossier, sous);
                if (Directory.Exists(d)) Directory.Delete(d, true);
            }

            Assembly asm = Assembly.GetExecutingAssembly();
            using (Stream flux = asm.GetManifestResourceStream("payload.zip"))
            using (ZipArchive zip = new ZipArchive(flux, ZipArchiveMode.Read))
            {
                long total = 0, fait = 0;
                foreach (ZipArchiveEntry e in zip.Entries) total += e.Length;
                if (total == 0) total = 1;
                string racine = Path.GetFullPath(dossier).TrimEnd('\\') + "\\";
                byte[] tampon = new byte[1 << 20];
                foreach (ZipArchiveEntry e in zip.Entries)
                {
                    string nom = e.FullName.Replace('/', '\\').TrimStart('.', '\\');
                    if (nom.Length == 0 || nom.EndsWith("\\")) continue;
                    if (nom.StartsWith("data\\", StringComparison.OrdinalIgnoreCase)) continue; // sécurité : jamais de données
                    string cible = Path.GetFullPath(Path.Combine(dossier, nom));
                    if (!cible.StartsWith(racine, StringComparison.OrdinalIgnoreCase)) continue; // archive piégée : ignorée
                    Directory.CreateDirectory(Path.GetDirectoryName(cible));
                    using (Stream entree = e.Open())
                    using (FileStream sortie = new FileStream(cible, FileMode.Create, FileAccess.Write))
                    {
                        int n;
                        while ((n = entree.Read(tampon, 0, tampon.Length)) > 0)
                        {
                            sortie.Write(tampon, 0, n);
                            fait += n;
                            progres((int)(fait * 95 / total), nom);
                        }
                    }
                }
            }

            progres(96, "Désinstalleur…");
            using (Stream des = asm.GetManifestResourceStream("Desinstaller.exe"))
            using (FileStream f = new FileStream(Path.Combine(dossier, "Desinstaller.exe"), FileMode.Create, FileAccess.Write))
                des.CopyTo(f);

            progres(97, "Raccourcis…");
            string exe = Path.Combine(dossier, "Atelier.exe");
            Directory.CreateDirectory(ProgrammesMenuDemarrer());
            Raccourci(Path.Combine(ProgrammesMenuDemarrer(), Nom + ".lnk"), exe, dossier, "Atelier marketing");
            if (bureau) Raccourci(LienBureau(), exe, dossier, "Atelier marketing");

            progres(99, "Enregistrement…");
            using (RegistryKey k = Registry.CurrentUser.CreateSubKey(CleDesinstall))
            {
                k.SetValue("DisplayName", Nom);
                k.SetValue("DisplayVersion", VersionApp.Numero);
                k.SetValue("Publisher", "Acoustiguide Japan");
                k.SetValue("InstallLocation", dossier);
                k.SetValue("DisplayIcon", exe + ",0");
                k.SetValue("UninstallString", "\"" + Path.Combine(dossier, "Desinstaller.exe") + "\"");
                k.SetValue("NoModify", 1, RegistryValueKind.DWord);
                k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                k.SetValue("EstimatedSize", (int)(TailleDossier(dossier) / 1024), RegistryValueKind.DWord);
            }
            progres(100, "Terminé");
            return null;
        }
        catch (Exception ex)
        {
            return "L'installation a échoué :\n" + ex.Message;
        }
    }

    static bool Fenetre(string dossierInitial)
    {
        bool ok = false;
        Form f = new Form();
        f.Text = "Installation — " + Nom;
        f.ClientSize = new Size(560, 330);
        f.FormBorderStyle = FormBorderStyle.FixedDialog;
        f.MaximizeBox = false; f.MinimizeBox = false;
        f.StartPosition = FormStartPosition.CenterScreen;
        try { f.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

        Label titre = new Label(); titre.Text = "Installer l'Atelier marketing"; titre.Font = new Font("Segoe UI", 15f, FontStyle.Bold);
        titre.Location = new Point(20, 16); titre.AutoSize = true;
        Label sous = new Label(); sous.Text = "Version " + VersionApp.Numero + " — installation pour votre compte Windows, sans droits d'administrateur.";
        sous.Location = new Point(22, 54); sous.Size = new Size(520, 20);
        Label lbl = new Label(); lbl.Text = "Dossier d'installation :"; lbl.Location = new Point(22, 90); lbl.AutoSize = true;
        TextBox chemin = new TextBox(); chemin.Text = dossierInitial; chemin.Location = new Point(22, 112); chemin.Size = new Size(430, 24);
        Button parcourir = new Button(); parcourir.Text = "Parcourir…"; parcourir.Location = new Point(460, 110); parcourir.Size = new Size(80, 28);
        parcourir.Click += delegate { using (FolderBrowserDialog d = new FolderBrowserDialog()) { if (d.ShowDialog() == DialogResult.OK) chemin.Text = Path.Combine(d.SelectedPath, Nom); } };
        CheckBox bureau = new CheckBox(); bureau.Text = "Créer un raccourci sur le Bureau"; bureau.Checked = true; bureau.Location = new Point(22, 150); bureau.AutoSize = true;
        CheckBox lancer = new CheckBox(); lancer.Text = "Lancer l'atelier à la fin"; lancer.Checked = true; lancer.Location = new Point(22, 176); lancer.AutoSize = true;
        Label note = new Label(); note.Text = "Une mise à jour remplace le programme mais ne touche jamais à vos projets, fichiers et identifiants (dossier « data »).";
        note.Location = new Point(22, 208); note.Size = new Size(520, 34); note.ForeColor = Color.DimGray;
        ProgressBar barre = new ProgressBar(); barre.Location = new Point(22, 252); barre.Size = new Size(518, 18); barre.Maximum = 100;
        Label etat = new Label(); etat.Location = new Point(22, 274); etat.Size = new Size(518, 18); etat.ForeColor = Color.DimGray;
        Button installer = new Button(); installer.Text = "Installer"; installer.Location = new Point(360, 292); installer.Size = new Size(88, 30);
        Button annuler = new Button(); annuler.Text = "Annuler"; annuler.Location = new Point(454, 292); annuler.Size = new Size(88, 30);
        annuler.Click += delegate { f.Close(); };

        installer.Click += delegate
        {
            installer.Enabled = false; annuler.Enabled = false; chemin.Enabled = false; parcourir.Enabled = false;
            string dossier = chemin.Text.Trim();
            bool b = bureau.Checked, l = lancer.Checked;
            BackgroundWorker w = new BackgroundWorker(); w.WorkerReportsProgress = true;
            string erreur = null;
            w.DoWork += delegate
            {
                erreur = Installation(dossier, b, delegate (int p, string txt) { w.ReportProgress(p, txt); });
            };
            w.ProgressChanged += delegate (object s, ProgressChangedEventArgs e) { barre.Value = Math.Min(100, e.ProgressPercentage); etat.Text = (e.UserState as string) ?? ""; };
            w.RunWorkerCompleted += delegate
            {
                if (erreur != null)
                {
                    MessageBox.Show(erreur, Nom, MessageBoxButtons.OK, MessageBoxIcon.Error);
                    installer.Enabled = true; annuler.Enabled = true; chemin.Enabled = true; parcourir.Enabled = true; return;
                }
                ok = true;
                MessageBox.Show("L'Atelier marketing est installé.\n\nVous le trouverez dans le menu Démarrer" + (b ? " et sur le Bureau" : "") + ".", Nom, MessageBoxButtons.OK, MessageBoxIcon.Information);
                if (l) Lancer(dossier);
                f.Close();
            };
            w.RunWorkerAsync();
        };
        f.Controls.AddRange(new Control[] { titre, sous, lbl, chemin, parcourir, bureau, lancer, note, barre, etat, installer, annuler });
        f.AcceptButton = installer;
        Application.Run(f);
        return ok;
    }
#else
    // ================================================================== DÉSINSTALLATION
    static int Desinstaller(string[] args)
    {
        string dossier = dossierDemande;
        bool copie = false;
        foreach (string a in args) if (a.ToLowerInvariant() == "/copie") copie = true;
        if (dossier == null)
        {
            try { using (RegistryKey k = Registry.CurrentUser.OpenSubKey(CleDesinstall)) dossier = k == null ? null : (string)k.GetValue("InstallLocation"); } catch { }
            if (dossier == null) dossier = Path.GetDirectoryName(Application.ExecutablePath);
        }

        // un programme ne peut pas supprimer le fichier qu'il exécute : on se relance depuis le dossier temporaire
        if (!copie)
        {
            string tmp = Path.Combine(Path.GetTempPath(), "desinstaller-atelier-" + Guid.NewGuid().ToString("N").Substring(0, 8) + ".exe");
            File.Copy(Application.ExecutablePath, tmp, true);
            string a2 = "/copie \"/dir=" + dossier + "\"" + (silencieux ? " /silent" : "") + (purge ? " /purge" : "");
            Process.Start(new ProcessStartInfo(tmp, a2) { UseShellExecute = false });
            return 0;
        }

        if (!silencieux && MessageBox.Show("Désinstaller l'Atelier marketing ?", Nom, MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return 1;
        Process[] actifs = EnCours(dossier);
        if (actifs.Length > 0)
        {
            if (!silencieux && MessageBox.Show("L'Atelier est ouvert : il va être fermé (un export vidéo en cours serait interrompu).\n\nContinuer ?", Nom, MessageBoxButtons.YesNo, MessageBoxIcon.Warning) != DialogResult.Yes) return 1;
            foreach (Process p in actifs) { try { if (p.Id != Process.GetCurrentProcess().Id) p.Kill(); } catch { } }
            System.Threading.Thread.Sleep(1500);
        }

        string data = Path.Combine(dossier, "data");
        bool supprimerDonnees = purge;
        if (!purge && !silencieux && Directory.Exists(data))
            supprimerDonnees = MessageBox.Show("Supprimer aussi vos données (projets, fichiers, exports, identifiants) ?\n\nDossier : " + data + "\n\nChoisissez « Non » pour les conserver : une réinstallation les retrouvera.",
                Nom, MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) == DialogResult.Yes;

        try
        {
            if (Directory.Exists(dossier))
            {
                foreach (string f in Directory.GetFiles(dossier)) { try { File.Delete(f); } catch { } }
                foreach (string d in Directory.GetDirectories(dossier))
                {
                    if (string.Equals(Path.GetFileName(d), "data", StringComparison.OrdinalIgnoreCase) && !supprimerDonnees) continue;
                    try { Directory.Delete(d, true); } catch { }
                }
                try { Directory.Delete(dossier, false); } catch { } // reste en place s'il contient encore les données
            }
            try { string m = ProgrammesMenuDemarrer(); if (Directory.Exists(m)) Directory.Delete(m, true); } catch { }
            try { if (File.Exists(LienBureau())) File.Delete(LienBureau()); } catch { }
            try { string p = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), Nom); if (Directory.Exists(p)) Directory.Delete(p, true); } catch { }
            try { Registry.CurrentUser.DeleteSubKeyTree(CleDesinstall, false); } catch { }
        }
        catch (Exception ex) { Info("La désinstallation est incomplète :\n" + ex.Message, MessageBoxIcon.Warning); return 1; }

        Info("L'Atelier marketing a été désinstallé." + (Directory.Exists(data) ? "\n\nVos données sont conservées dans :\n" + data : ""), MessageBoxIcon.Information);
        // le programme temporaire s'efface lui-même après sa fermeture
        try { Process.Start(new ProcessStartInfo("cmd.exe", "/c ping 127.0.0.1 -n 3 >nul & del \"" + Application.ExecutablePath + "\"") { CreateNoWindow = true, UseShellExecute = false }); } catch { }
        return 0;
    }
#endif
}
