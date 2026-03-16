import { en, type I18nDictionary } from "./en.js";

export const fr: I18nDictionary = {
  ...en,
  "cmd.description.status": "Statut du serveur et de la session",
  "cmd.description.new": "Créer une nouvelle session",
  "cmd.description.sessions": "Lister les sessions",
  "cmd.description.last": "Afficher le dernier message de la session",
  "cmd.description.projects": "Lister les projets",
  "cmd.description.commands": "Commandes personnalisées",
  "cmd.description.opencode_start": "Démarrer le serveur OpenCode",
  "cmd.description.opencode_stop": "Arrêter le serveur OpenCode",
  "cmd.description.help": "Aide",
  "common.unknown": "inconnu",
  "common.unknown_error": "erreur inconnue",
  "status.header_running": "🟢 Le serveur OpenCode est en cours d'exécution",
  "status.health.healthy": "Sain",
  "status.health.unhealthy": "Dégradé",
  "status.line.health": "Statut : {health}",
  "status.line.version": "Version : {version}",
  "status.server_unavailable":
    "🔴 Le serveur OpenCode est indisponible\n\nUtilisez /opencode_start pour démarrer le serveur.",
  "opencode_start.starting": "🔄 Démarrage du serveur OpenCode...",
  "opencode_start.start_error":
    "🔴 Impossible de démarrer le serveur OpenCode\n\nErreur : {error}\n\nVérifiez que l'interface en ligne de commande OpenCode est installée et disponible dans le PATH :\nopencode --version\nnpm install -g @opencode-ai/cli",
  "opencode_start.started_not_ready":
    "⚠️ Le serveur OpenCode a démarré, mais ne répond pas encore\n\nPID : {pid}\n\nLe serveur est peut-être encore en cours de démarrage. Essayez /status dans quelques secondes.",
  "opencode_start.success":
    "✅ Serveur OpenCode démarré avec succès\n\nPID : {pid}\nVersion : {version}",
  "permission.header": "{emoji} Demande d'autorisation : {name}\n\n",
  "permission.button.allow": "✅ Autoriser une fois",
  "permission.button.always": "🔓 Toujours autoriser",
  "permission.button.reject": "❌ Refuser",
  "permission.name.edit": "Modifier",
  "permission.name.write": "Écrire",
  "permission.name.read": "Lire",
  "permission.name.webfetch": "Récupération web",
  "permission.name.websearch": "Recherche web",
  "permission.name.glob": "Recherche de fichiers",
  "permission.name.grep": "Recherche de contenu",
  "permission.name.list": "Lister le répertoire",
  "permission.name.task": "Tâche",
  "permission.name.external_directory": "Répertoire externe",
  "question.multi_hint": "\n(Vous pouvez sélectionner plusieurs options)",
  "legacy.models.header": "📋 Modèles disponibles :\n\n",
  "legacy.models.fetch_error":
    "🔴 Impossible de récupérer la liste des modèles. Vérifiez l'état du serveur avec /status.",
  "legacy.models.empty": "📋 Aucun modèle disponible. Configurez les fournisseurs dans OpenCode.",
};
