const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// Game state management
const gameRooms = new Map();

class LudoGame {
  constructor(roomId) {
    this.roomId = roomId;
    this.players = [];
    this.currentTurn = 0;
    this.gameStarted = false;
    this.winner = null;
    this.diceValue = 0;
    this.canRoll = true;
    this.consecutiveSixes = 0;
    
    // Initialize board positions for 4 players
    this.pawns = {
      0: [{ pos: -1, id: 0 }, { pos: -1, id: 1 }, { pos: -1, id: 2 }, { pos: -1, id: 3 }], // Red
      1: [{ pos: -1, id: 0 }, { pos: -1, id: 1 }, { pos: -1, id: 2 }, { pos: -1, id: 3 }], // Blue
      2: [{ pos: -1, id: 0 }, { pos: -1, id: 1 }, { pos: -1, id: 2 }, { pos: -1, id: 3 }], // Yellow
      3: [{ pos: -1, id: 0 }, { pos: -1, id: 1 }, { pos: -1, id: 2 }, { pos: -1, id: 3 }]  // Green
    };
    
    // Starting positions for each player
    this.startPositions = [0, 13, 26, 39];
    this.homePositions = [1, 14, 27, 40]; // Safe positions after start
    this.finishPositions = [56, 57, 58, 59]; // Finish line positions
  }

  addPlayer(playerId, playerName) {
    if (this.players.length >= 4) return false;
    
    const playerColor = ['red', 'blue', 'yellow', 'green'][this.players.length];
    this.players.push({ id: playerId, name: playerName, color: playerColor, index: this.players.length });
    
    if (this.players.length === 4) {
      this.gameStarted = true;
    }
    
    return true;
  }

  removePlayer(playerId) {
    this.players = this.players.filter(p => p.id !== playerId);
    if (this.players.length < 4) {
      this.gameStarted = false;
    }
  }

  rollDice() {
    if (!this.canRoll) return null;
    
    this.diceValue = Math.floor(Math.random() * 6) + 1;
    this.canRoll = false;
    
    if (this.diceValue === 6) {
      this.consecutiveSixes++;
      if (this.consecutiveSixes >= 3) {
        // Three consecutive sixes - lose turn
        this.consecutiveSixes = 0;
        this.nextTurn();
      }
    } else {
      this.consecutiveSixes = 0;
    }
    
    return this.diceValue;
  }

  getValidMoves(playerIndex) {
    const moves = [];
    const playerPawns = this.pawns[playerIndex];
    
    playerPawns.forEach((pawn, pawnIndex) => {
      if (this.canMovePawn(playerIndex, pawnIndex)) {
        moves.push(pawnIndex);
      }
    });
    
    return moves;
  }

  canMovePawn(playerIndex, pawnIndex) {
    const pawn = this.pawns[playerIndex][pawnIndex];
    
    // If pawn is at home (-1) and dice is 6, can move out
    if (pawn.pos === -1 && this.diceValue === 6) {
      return true;
    }
    
    // If pawn is on board, can move if won't exceed finish
    if (pawn.pos >= 0) {
      const newPos = this.calculateNewPosition(playerIndex, pawn.pos, this.diceValue);
      return newPos !== -1;
    }
    
    return false;
  }

  calculateNewPosition(playerIndex, currentPos, diceValue) {
    // If pawn is at home and dice is 6, move to start position
    if (currentPos === -1 && diceValue === 6) {
      return this.startPositions[playerIndex];
    }
    
    if (currentPos === -1) return -1;
    
    const newPos = currentPos + diceValue;
    
    // Check if pawn has completed a full lap and is heading home
    const startPos = this.startPositions[playerIndex];
    if (currentPos >= startPos && newPos >= startPos + 51) {
      const homeTrackPos = (newPos - startPos) - 51;
      if (homeTrackPos <= 5) {
        return 52 + playerIndex * 6 + homeTrackPos; // Home track positions
      }
      return -1; // Invalid move
    }
    
    return newPos % 52;
  }

  movePawn(playerIndex, pawnIndex) {
    if (!this.gameStarted || this.currentTurn !== playerIndex || this.canRoll) {
      return false;
    }
    
    if (!this.canMovePawn(playerIndex, pawnIndex)) {
      return false;
    }
    
    const pawn = this.pawns[playerIndex][pawnIndex];
    const newPos = this.calculateNewPosition(playerIndex, pawn.pos, this.diceValue);
    
    if (newPos === -1) return false;
    
    // Check for captures
    this.checkCapture(newPos, playerIndex);
    
    // Move the pawn
    pawn.pos = newPos;
    
    // Check win condition
    this.checkWinner();
    
    // Handle turn progression
    if (this.diceValue !== 6) {
      this.nextTurn();
    } else {
      this.canRoll = true;
    }
    
    return true;
  }

  checkCapture(position, currentPlayerIndex) {
    // Check if any other player's pawn is at this position
    for (let playerIndex = 0; playerIndex < 4; playerIndex++) {
      if (playerIndex === currentPlayerIndex) continue;
      
      this.pawns[playerIndex].forEach(pawn => {
        if (pawn.pos === position && !this.isSafePosition(position)) {
          pawn.pos = -1; // Send back to home
        }
      });
    }
  }

  isSafePosition(position) {
    // Safe positions are start positions and some special squares
    return this.startPositions.includes(position) || 
           this.homePositions.includes(position) ||
           position >= 52; // Home track is always safe
  }

  checkWinner() {
    for (let playerIndex = 0; playerIndex < 4; playerIndex++) {
      const playerPawns = this.pawns[playerIndex];
      const finishedPawns = playerPawns.filter(pawn => pawn.pos >= 52 + playerIndex * 6 + 5);
      
      if (finishedPawns.length === 4) {
        this.winner = playerIndex;
        return;
      }
    }
  }

  nextTurn() {
    this.currentTurn = (this.currentTurn + 1) % 4;
    this.canRoll = true;
    this.diceValue = 0;
  }

  getGameState() {
    return {
      roomId: this.roomId,
      players: this.players,
      currentTurn: this.currentTurn,
      gameStarted: this.gameStarted,
      winner: this.winner,
      diceValue: this.diceValue,
      canRoll: this.canRoll,
      pawns: this.pawns,
      validMoves: this.gameStarted ? this.getValidMoves(this.currentTurn) : []
    };
  }
}

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-game', ({ roomId, playerName }) => {
    // Leave any existing rooms
    Array.from(socket.rooms).forEach(room => {
      if (room !== socket.id) {
        socket.leave(room);
      }
    });

    // Create or join game room
    if (!gameRooms.has(roomId)) {
      gameRooms.set(roomId, new LudoGame(roomId));
    }

    const game = gameRooms.get(roomId);
    
    if (game.addPlayer(socket.id, playerName)) {
      socket.join(roomId);
      socket.roomId = roomId;
      
      // Broadcast updated game state to all players in room
      io.to(roomId).emit('game-state', game.getGameState());
      
      console.log(`Player ${playerName} joined room ${roomId}`);
    } else {
      socket.emit('error', 'Room is full');
    }
  });

  socket.on('roll-dice', () => {
    const roomId = socket.roomId;
    if (!roomId || !gameRooms.has(roomId)) return;
    
    const game = gameRooms.get(roomId);
    const currentPlayer = game.players[game.currentTurn];
    
    if (currentPlayer && currentPlayer.id === socket.id) {
      const diceValue = game.rollDice();
      if (diceValue) {
        io.to(roomId).emit('game-state', game.getGameState());
      }
    }
  });

  socket.on('move-pawn', ({ pawnIndex }) => {
    const roomId = socket.roomId;
    if (!roomId || !gameRooms.has(roomId)) return;
    
    const game = gameRooms.get(roomId);
    const currentPlayer = game.players[game.currentTurn];
    
    if (currentPlayer && currentPlayer.id === socket.id) {
      if (game.movePawn(game.currentTurn, pawnIndex)) {
        io.to(roomId).emit('game-state', game.getGameState());
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    // Remove player from game room
    if (socket.roomId && gameRooms.has(socket.roomId)) {
      const game = gameRooms.get(socket.roomId);
      game.removePlayer(socket.id);
      
      if (game.players.length === 0) {
        gameRooms.delete(socket.roomId);
      } else {
        io.to(socket.roomId).emit('game-state', game.getGameState());
      }
    }
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', activeRooms: gameRooms.size });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Ludo game server running on port ${PORT}`);
});
