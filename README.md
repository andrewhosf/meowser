# Meowser

A web-based cat raising game where you adopt a cat, take care of it, earn Meowcoins from the Catstream, and send your cat to the Catdergarten to hang out with other players' cats.

## How to Run

1. Open a terminal and go to the server folder:
   ```
   cd meowser/server
   ```

2. Install dependencies (only needed once):
   ```
   npm install
   ```

3. Start the server:
   ```
   npm start
   ```

4. Open your browser to:
   ```
   http://localhost:3000
   ```

## Game Features

- **7 cat types**: Tabby, Siamese, Maine Coon, Persian, Sphynx, Scottish Fold, Calico
- **Customize**: Pick fur color and eye color
- **Care**: Feed, pet, play, and talk to your cat
- **Food**: Dry food, wet food, A5 Wagyu, and... roadkill
- **Room**: Your cat walks around a room with a bed, couch, cat bed, bowls, and sandbox
- **Shop**: Buy cat trees, loungers, toy mice, and scratching posts
- **Catstream**: Claim daily UBI-style Meowcoins. Well-cared cats get +20% bonus!
- **Catdergarten**: Send your cat to socialize with other players in real-time
- **Auth**: Register with email, login, and reset your password

## For Developers

The game is built with:
- **Backend**: Node.js, Express, SQLite, Socket.io
- **Frontend**: HTML5 Canvas, vanilla JavaScript, CSS
- **No build step** - easy to open files and experiment!

### Project Layout

```
meowser/
  server/
    server.js      - Main server (API + WebSocket)
    package.json   - Dependencies
  client/
    index.html     - Game pages
    style.css      - Styles
    game.js        - All game logic and rendering
  README.md        - This file
```

### Fun Things to Hack On

- Add more furniture types in `game.js` and `server.js`
- Draw new cat accessories (hats, bows)
- Add mini-games for the "play" action
- Change the Catstream formula
- Add sound effects when the cat meows
- Make the cat react when you click on it in the room

## Password Reset

For demo/development, password reset emails are captured by Ethereal Email (a fake SMTP service). When you request a reset, check the server console - it will print a preview URL where you can see the reset email.

For a real game, replace the Ethereal setup in `server.js` with real SMTP credentials (Gmail, SendGrid, etc.).
