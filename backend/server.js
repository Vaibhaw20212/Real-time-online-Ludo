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
    this.gameFinished = false;
    this.rankings = []; // Track finish order
    
    // Initialize board positions for 4 players
    this.pawns = {
      0: [{ pos: -1, id: 0 }, { pos: -1, id: 1 }, { pos: -1, id: 2 }, { pos: -1, id: 3 }], // Red
      1: [{ pos: -1, id: 0 }, { pos: -1, id: 1 }, { pos: -1, id: 2 }, { pos: -1, id: 3 }], // Blue
      2: [{ pos: -1, id: 0 }, { pos: -1, id: 1 }, { pos: -1, id: 2 }, { pos: -1, id: 3 }], // Yellow
      3: [{ pos: -1, id: 0 }, { pos: -1, id: 1 }, { pos: -1, id: 2 }, { pos: -1, id: 3 }]  // Green
    };
    
    // Starting positions for each player on the main track
    this.startPositions = [1, 14, 27, 40]; // Entry points after rolling 6
    this.safePositions = [1, 9, 14, 22, 27, 35, 40, 48]; // Safe squares
    this.homeStretchStart = [51, 12, 25, 38]; // Where home stretch begins for each player
  }

  addPlayer(playerId, playerName) {
    if (this.players.length >= 4) return false;
    
    const playerColor = ['red', 'blue', 'yellow', 'green'][this.players.length];
    this.players.push({ 
      id: playerId, 
      name: playerName, 
      color: playerColor, 
      index: this.players.length,
      finished: false,
      finishRank: null
    });
    
    return true;
  }

  removePlayer(playerId) {
    this.players = this.players.filter(p => p.id !== playerId);
    if (this.players.length < 2) {
      this.gameStarted = false;
    }
  }

  startGame() {
    if (this.players.length >= 2 && !this.gameStarted) {
      this.gameStarted = true;
      this.currentTurn = 0;
      return true;
    }
    return false;
  }

  rollDice() {
    if (!this.canRoll || this.gameFinished) return null;
    
    this.diceValue = Math.floor(Math.random() * 6) + 1;
    this.canRoll = false;
    
    if (this.diceValue === 6) {
      this.consecutiveSixes++;
      if (this.consecutiveSixes >= 3) {
        // Three consecutive sixes - lose turn
        this.consecutiveSixes = 0;
        this.nextTurn();
        return this.diceValue;
      }
    } else {
      this.consecutiveSixes = 0;
    }
    
    // Check if player has any valid moves
    const validMoves = this.getValidMoves(this.currentTurn);
    if (validMoves.length === 0) {
      // No valid moves, skip turn
      setTimeout(() => {
        this.nextTurn();
      }, 1000);
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
    
    // If pawn is on board
    if (pawn.pos >= 0) {
      const newPos = this.calculateNewPosition(playerIndex, pawn.pos, this.diceValue);
      
      // Check if new position is valid
      if (newPos === -1) return false;
      
      // Check if new position is blocked by enemy stack
      if (this.isBlocked(newPos, playerIndex)) return false;
      
      return true;
    }
    
    return false;
  }

  calculateNewPosition(playerIndex, currentPos, diceValue) {
    // If pawn is at home and dice is 6, move to start position
    if (currentPos === -1 && diceValue === 6) {
      return this.startPositions[playerIndex];
    }
    
    if (currentPos === -1) return -1;
    
    // Check if pawn is in home stretch (positions 100+)
    if (currentPos >= 100) {
      const homePos = currentPos - 100;
      const newHomePos = homePos + diceValue;
      if (newHomePos > 6) return -1; // Can't overshoot home
      if (newHomePos === 6) return 106; // Final home position
      return 100 + newHomePos;
    }
    
    // Regular board movement
    const newPos = currentPos + diceValue;
    
    // Check if pawn should enter home stretch
    const homeEntry = this.homeStretchStart[playerIndex];
    if (currentPos <= homeEntry && newPos > homeEntry) {
      // Calculate how many steps into home stretch
      const homeSteps = newPos - homeEntry;
      if (homeSteps > 6) return -1; // Can't overshoot
      if (homeSteps === 6) return 106; // Final home
      return 100 + homeSteps; // Home stretch positions
    }
    
    // Normal circular movement
    return newPos > 52 ? newPos - 52 : newPos;
  }

  isBlocked(position, playerIndex) {
    // Count enemy pawns at this position
    let enemyCount = 0;
    for (let i = 0; i < 4; i++) {
      if (i === playerIndex) continue;
      if (i >= this.players.length) continue;
      
      const enemyPawns = this.pawns[i].filter(pawn => pawn.pos === position);
      enemyCount += enemyPawns.length;
    }
    
    // Blocked if 2 or more enemy pawns
    return enemyCount >= 2;
  }

  movePawn(playerIndex, pawnIndex) {
    if (!this.gameStarted || this.currentTurn !== playerIndex || this.canRoll || this.gameFinished) {
      return false;
    }
    
    if (!this.canMovePawn(playerIndex, pawnIndex)) {
      return false;
    }
    
    const pawn = this.pawns[playerIndex][pawnIndex];
    const oldPos = pawn.pos;
    const newPos = this.calculateNewPosition(playerIndex, pawn.pos, this.diceValue);
    
    if (newPos === -1) return false;
    
    // Check for captures (only on regular board, not in home stretch)
    if (newPos < 100 && newPos !== 106) {
      this.checkCapture(newPos, playerIndex);
    }
    
    // Move the pawn
    pawn.pos = newPos;
    
    // Check win condition
    this.checkWinner();
    
    // Handle turn progression
    if (this.diceValue !== 6 && newPos !== 106) { // Extra turn for 6 or reaching home
      this.nextTurn();
    } else {
      this.canRoll = true;
    }
    
    return true;
  }

  checkCapture(position, currentPlayerIndex) {
    // Don't capture on safe positions
    if (this.safePositions.includes(position)) return;
    
    // Check if any other player's pawn is at this position
    for (let playerIndex = 0; playerIndex < 4; playerIndex++) {
      if (playerIndex === currentPlayerIndex) continue;
      if (playerIndex >= this.players.length) continue;
      
      const pawnsAtPosition = this.pawns[playerIndex].filter(pawn => pawn.pos === position);
      
      // Only capture if exactly one enemy pawn (not a stack)
      if (pawnsAtPosition.length === 1) {
        pawnsAtPosition[0].pos = -1; // Send back to home
      }
    }
  }

  checkWinner() {
    for (let playerIndex = 0; playerIndex < this.players.length; playerIndex++) {
      const player = this.players[playerIndex];
      if (player.finished) continue;
      
      const playerPawns = this.pawns[playerIndex];
      const finishedPawns = playerPawns.filter(pawn => pawn.pos === 106);
      
      if (finishedPawns.length === 4) {
        player.finished = true;
        player.finishRank = this.rankings.length + 1;
        this.rankings.push(playerIndex);
        
        if (this.winner === null) {
          this.winner = playerIndex;
        }
        
        // Check if game is completely finished
        const activePlayers = this.players.filter(p => !p.finished);
        if (activePlayers.length <= 1) {
          this.gameFinished = true;
        }
      }
    }
  }

  nextTurn() {
    do {
      this.currentTurn = (this.currentTurn + 1) % this.players.length;
    } while (this.players[this.currentTurn].finished && !this.gameFinished);
    
    this.canRoll = true;
    this.diceValue = 0;
    this.consecutiveSixes = 0;
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
      validMoves: this.gameStarted ? this.getValidMoves(this.currentTurn) : [],
      gameFinished: this.gameFinished,
      rankings: this.rankings,
      safePositions: this.safePositions
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

  socket.on('start-game', () => {
    const roomId = socket.roomId;
    if (!roomId || !gameRooms.has(roomId)) return;
    
    const game = gameRooms.get(roomId);
    if (game.startGame()) {
      io.to(roomId).emit('game-state', game.getGameState());
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
        io.to(roomId).emit('dice-rolled', { value: diceValue, player: game.currentTurn });
        setTimeout(() => {
          io.to(roomId).emit('game-state', game.getGameState());
        }, 1000);
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
        io.to(roomId).emit('pawn-moved', { 
          player: game.currentTurn, 
          pawn: pawnIndex,
          newPosition: game.pawns[game.currentTurn][pawnIndex].pos
        });
        setTimeout(() => {
          io.to(roomId).emit('game-state', game.getGameState());
        }, 500);
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
