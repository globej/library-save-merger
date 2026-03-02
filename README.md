# JW Library Merger Web

Une application web simple et élégante permettant de fusionner deux fichiers de sauvegarde `.jwlibrary` directement depuis votre navigateur. Aucune installation ni serveur n'est nécessaire !

Inspiré du projet original [go-library-merger](https://github.com/AndreasSko/go-library-merger) développé par AndreasSko.

## ✨ Fonctionnalités

- 🔒 **100% Côté Client (Local)** : Vos données personnelles et sauvegardes ne quittent jamais votre appareil. Tout le traitement est effectué localement dans votre navigateur.
- 🔀 **Gestion Avancée des Conflits** : Choisissez précisément comment résoudre les conflits entre vos deux fichiers pour les éléments suivants :
  - **Signets (Bookmarks)** : Conserver le fichier de gauche ou de droite.
  - **Marquages (Markings)** : Conserver le fichier de gauche ou de droite.
  - **Notes** : Garder la note la plus récente, celle de gauche ou celle de droite.
  - **Champs de saisie (Input Fields)** : Conserver le fichier de gauche ou de droite.
- 🌍 **Support Multilingue** : Interface disponible en Français et en Anglais.
- 🎨 **Design Moderne** : Interface utilisateur intuitive avec effet "glassmorphism", design responsive, et support du glisser-déposer (Drag & Drop).

## 🚀 Comment l'utiliser

Puisque l'application fonctionne entièrement dans le navigateur, vous pouvez simplement l'héberger sur n'importe quel serveur web statique (comme GitHub Pages, Vercel, Netlify) ou l'ouvrir localement.

1. Ouvrez `index.html` dans un navigateur moderne (Chrome, Firefox, Edge, Safari).
2. Glissez-déposez votre première sauvegarde dans la zone **Sauvegarde Gauche**.
3. Glissez-déposez votre seconde sauvegarde dans la zone **Sauvegarde Droite**.
4. Ajustez les résolveurs de conflits si nécessaire selon vos préférences.
5. Cliquez sur le bouton **Fusionner**.
6. Le nouveau fichier `.jwlibrary` fusionné sera généré et téléchargé automatiquement sur votre appareil.

## 🛠️ Technologies Utilisées

- HTML5
- CSS3 (Vanilla, variables CSS, Flexbox/Grid)
- JavaScript Vanilla
- [JSZip](https://stuk.github.io/jszip/) (v3.10.1) - Pour décompresser et recompresser les archives des sauvegardes `.jwlibrary`.
- [sql.js](https://sql.js.org/) (v1.8.0 avec WebAssembly) - Pour lire, manipuler et fusionner les bases de données SQLite contenues dans les sauvegardes.

## 📝 Vie privée (Privacy)

Ce projet a été conçu selon le principe de la protection de la vie privée dès la conception (Privacy by Design). L'intégralité du code s'exécute côté client. Absolument aucune donnée, aucun fichier et aucune information personnelle n'est envoyée à un serveur tiers ou stockée en ligne.

## 🤝 Contribuer

Les contributions, les signalements de bugs et les demandes de fonctionnalités sont les bienvenus ! N'hésitez pas à ouvrir une *Issue* ou à soumettre une *Pull Request*.

---

*Note : Ce projet est un outil tiers indépendant et n'est ni affilié, ni associé, ni autorisé, ni approuvé par la Watch Tower Bible and Tract Society of Pennsylvania ou aucune entité liée.*
