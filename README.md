<p align="center">
  <img src="windows/shared/novaiaweb-icon.png" alt="Logo NovaPrompter" width="96" height="96">
</p>

<h1 align="center">NovaPrompter <sub>by novaiaweb</sub></h1>

Téléprompteur Windows avec un éditeur de scripts et une fenêtre flottante qui peut suivre votre voix en français.

**[↓ Télécharger NovaPrompter pour Windows 64 bits](https://github.com/novaiax/NovaPrompter-App/releases/latest/download/NovaPrompter-Installation.exe)** · [Versions et notes de publication](https://github.com/novaiax/NovaPrompter-App/releases)

## Installer et utiliser

1. Téléchargez **NovaPrompter-Installation.exe** depuis le lien ci-dessus. L’installateur est testé sur Windows 11 x64. Le téléchargement est public et accessible sans compte GitHub.
2. Ouvrez l’installateur et choisissez **Installer pour moi**. Lancez ensuite **NovaPrompter** depuis le Bureau ou le menu Démarrer.
3. Créez ou importez un script, puis cliquez sur **Ouvrir le prompteur**.
4. Sélectionnez **Voix** et testez votre micro avant de démarrer, ou choisissez **Auto** pour régler le débit en mots par minute.

L’installateur inclut le modèle vocal français. Windows peut afficher un avertissement, car cette version est distribuée sans signature Authenticode. L’empreinte SHA-256 est indiquée dans les notes de version.

## Pendant la lecture

- **Suivi vocal en français** — le texte attend pendant une pause ou une improvisation et reprend quand vous revenez au script.
- **Fenêtre flottante** — déplacez-la par sa barre supérieure et redimensionnez-la avec la poignée en bas à droite. Elle se souvient de sa position et de sa taille.
- **Reprise à un passage** — utilisez la barre de progression, cliquez sur un mot ou avancez à la molette.
- **Préparation des scripts** — enregistrement automatique, nettoyage avec aperçu et annulation, repères de pause, compte à rebours, import TXT, Markdown, SRT, VTT et sauvegardes JSON.

## Confidentialité

Sur Windows, la reconnaissance de la voix est calculée sur votre ordinateur. Les scripts et les réglages sont enregistrés dans votre profil Windows, dans `%APPDATA%\novaprompter`. La synchronisation est facultative et envoie les scripts au serveur que vous renseignez dans **Réglages → Intégrations**.

<details>
<summary>Construire et tester depuis le code source</summary>

Sur Windows x64, installez Node.js 24 puis exécutez les commandes suivantes.

```powershell
npm ci
npm run speech:prepare
npm start
```

```powershell
npm test
npm run test:desktop
npm run dist:win
```

Les tests desktop utilisent une voix française de synthèse installée dans Windows et des serveurs locaux de test. `NOVAPROMPTER_TEST_EXE` permet de tester un exécutable assemblé. `NOVAPROMPTER_NATIVE_MOUSE=1` active les tests de déplacement et de redimensionnement avec la souris dans une session Windows interactive.

La construction produit `dist/NovaPrompter-Installation.exe`. Ce nom est utilisé pour l’asset de chaque publication stable afin que le lien de téléchargement pointe vers la version la plus récente.

La [version web mobile](mobile/README.md) et le [serveur facultatif de synchronisation](backend/README.md) disposent de leur propre documentation. La [licence MIT](LICENSE), les notices du [modèle Vosk](https://alphacephei.com/vosk/models) et les [licences des polices](windows/shared/fonts/) accompagnent le code et la distribution.

</details>
