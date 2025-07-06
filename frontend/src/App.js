import React, { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import './App.css';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'https://real-time-online-ludo-production.up.railway.app';

const App = () => {
  const [socket, setSocket] = useState(null);
  const [gameState, setGameState] = useState(null);
  const [playerName, setPlayerName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [connected, setConnected] = useState(false);
  const [myPlayerIndex, setMyPlayerIndex] = useState(-1);
  const [error, setError] = useState('');

  useEffect(() => {
    const newSocket = io(BACKEND_URL);
    setSocket(newSocket);

    newSocket.on('connect', () => {
      console.log('Connected to server');
      setConnected(true);
    });

    newSocket.on('disconnect', () => {
      console.log('Disconnected from server');
      setConnected(false);
    });

    newSocket.on('game-state', (state) => {
      setGameState(state);
      // Find my player index
      const myIndex = state.players.findIndex(p => p.id === newSocket.id);
      setMyPlayerIndex(myIndex);
    });

    newSocket.on('error', (errorMsg) => {
      setError(errorMsg);
    });

    return () => newSocket.close();
  }, []);

  const joinGame = () => {
    if (!playerName.trim() || !roomId.trim()) {
      setError('Please enter both name and room ID');
      return;
    }
    
    setError('');
    socket.emit('join-game', { roomId: roomId.trim(), playerName: playerName.trim() });
  };

  const rollDice = () => {
    socket.emit('roll-dice');
  };

  const movePawn = (pawnIndex) => {
    socket.emit('move-pawn', { pawnIndex });
  };

  const renderBoard = () => {
    if (!gameState) return null;

    const colors = ['red', 'blue', 'yellow', 'green'];
    const boardSize = 15;
    const cells = [];

    // Create board grid
    for (let row = 0; row < boardSize; row++) {
      for (let col = 0; col < boardSize; col++) {
        const cellKey = `${row}-${col}`;
        const isPath = isPathCell(row, col);
        const isHome = isHomeCell(row, col);
        const isCenter = row >= 6 && row <= 8 && col >= 6 && col <= 8;
        
        let cellClass = 'cell';
        if (isPath) cellClass += ' path';
        if (isHome) cellClass += ` home ${getHomeCellColor(row, col)}`;
        if (isCenter) cellClass += ' center';
        
        const pawnsAtCell = getPawnsAtCell(row, col);
        
        cells.push(
          <div key={cellKey} className={cellClass}>
            {pawnsAtCell.map((pawn, idx) => (
              <div
                key={`${pawn.player}-${pawn.pawn}`}
                className={`pawn ${colors[pawn.player]} ${
                  myPlayerIndex === gameState.currentTurn && 
                  pawn.player === myPlayerIndex && 
                  gameState.validMoves.includes(pawn.pawn) ? 'movable' : ''
                }`}
                onClick={() => {
                  if (myPlayerIndex === gameState.currentTurn && 
                      pawn.player === myPlayerIndex && 
                      gameState.validMoves.includes(pawn.pawn)) {
                    movePawn(pawn.pawn);
                  }
                }}
                style={{
                  position: 'absolute',
                  left: `${idx * 8}px`,
                  top: `${idx * 8}px`
                }}
              />
            ))}
          </div>
        );
      }
    }

    return <div className="board">{cells}</div>;
  };

  const isPathCell = (row, col) => {
    // Main path cells
    if (row === 6 && (col >= 0 && col <= 5)) return true; // Top horizontal
    if (row === 8 && (col >= 9 && col <= 14)) return true; // Bottom horizontal
    if (col === 6 && (row >= 0 && row <= 5)) return true; // Left vertical
    if (col === 8 && (row >= 9 && row <= 14)) return true; // Right vertical
    
    // Cross paths
    if (row === 6 && col >= 9 && col <= 14) return true;
    if (row === 8 && col >= 0 && col <= 5) return true;
    if (col === 6 && row >= 9 && row <= 14) return true;
    if (col === 8 && row >= 0 && row <= 5) return true;
    
    return false;
  };

  const isHomeCell = (row, col) => {
    // Red home (top-left)
    if (row >= 0 && row <= 5 && col >= 0 && col <= 5) return true;
    // Blue home (top-right)
    if (row >= 0 && row <= 5 && col >= 9 && col <= 14) return true;
    // Yellow home (bottom-left)
    if (row >= 9 && row <= 14 && col >= 0 && col <= 5) return true;
    // Green home (bottom-right)
    if (row >= 9 && row <= 14 && col >= 9 && col <= 14) return true;
    
    return false;
  };

  const getHomeCellColor = (row, col) => {
    if (row >= 0 && row <= 5 && col >= 0 && col <= 5) return 'red';
    if (row >= 0 && row <= 5 && col >= 9 && col <= 14) return 'blue';
    if (row >= 9 && row <= 14 && col >= 0 && col <= 5) return 'yellow';
    if (row >= 9 && row <= 14 && col >= 9 && col <= 14) return 'green';
    return '';
  };

  const getPawnsAtCell = (row, col) => {
    if (!gameState) return [];
    
    const pawns = [];
    const cellPosition = getCellPosition(row, col);
    
    // Check for pawns in home positions
    if (isHomeCell(row, col)) {
      const homeColor = getHomeCellColor(row, col);
      const playerIndex = ['red', 'blue', 'yellow', 'green'].indexOf(homeColor);
      
      if (playerIndex >= 0) {
        gameState.pawns[playerIndex].forEach((pawn, pawnIndex) => {
          if (pawn.pos === -1 && isInHomeArea(row, col, playerIndex)) {
            pawns.push({ player: playerIndex, pawn: pawnIndex });
          }
        });
      }
    }
    
    // Check for pawns on path
    if (cellPosition >= 0) {
      for (let playerIndex = 0; playerIndex < 4; playerIndex++) {
        gameState.pawns[playerIndex].forEach((pawn, pawnIndex) => {
          if (pawn.pos === cellPosition) {
            pawns.push({ player: playerIndex, pawn: pawnIndex });
          }
        });
      }
    }
    
    return pawns;
  };

  const getCellPosition = (row, col) => {
    // Map board coordinates to game positions
    const pathMap = {
      // Bottom horizontal (positions 0-5)
      '8-0': 0, '8-1': 1, '8-2': 2, '8-3': 3, '8-4': 4, '8-5': 5,
      // Left vertical (positions 6-11)
      '7-6': 6, '6-6': 7, '5-6': 8, '4-6': 9, '3-6': 10, '2-6': 11,
      // Top horizontal (positions 12-17)
      '1-6': 12, '0-6': 13, '0-7': 14, '0-8': 15, '1-8': 16, '2-8': 17,
      // Right vertical (positions 18-23)
      '3-8': 18, '4-8': 19, '5-8': 20, '6-8': 21, '7-8': 22, '8-8': 23,
      // Continue mapping...
    };
    
    return pathMap[`${row}-${col}`] || -1;
  };

  const isInHomeArea = (row, col, playerIndex) => {
    const homeAreas = [
      [[1, 1], [1, 2], [2, 1], [2, 2]], // Red
      [[1, 12], [1, 13], [2, 12], [2, 13]], // Blue
      [[12, 1], [12, 2], [13, 1], [13, 2]], // Yellow
      [[12, 12], [12, 13], [13, 12], [13, 13]] // Green
    ];
    
    return homeAreas[playerIndex].some(([r, c]) => r === row && c === col);
  };

  if (!connected) {
    return <div className="loading">Connecting to server...</div>;
  }

  if (!gameState) {
    return (
      <div className="lobby">
        <h1>🎲 Ludo Game</h1>
        <div className="join-form">
          <input
            type="text"
            placeholder="Enter your name"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            className="input"
          />
          <input
            type="text"
            placeholder="Enter room ID"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            className="input"
          />
          <button onClick={joinGame} className="button">Join Game</button>
          {error && <div className="error">{error}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="game-container">
      <div className="game-header">
        <h1>🎲 Ludo Game - Room: {gameState.roomId}</h1>
        <div className="players">
          {gameState.players.map((player, index) => (
            <div 
              key={player.id} 
              className={`player ${player.color} ${index === gameState.currentTurn ? 'current-turn' : ''}`}
            >
              {player.name} {index === myPlayerIndex && '(You)'}
            </div>
          ))}
        </div>
      </div>

      {!gameState.gameStarted && (
        <div className="waiting">
          Waiting for players... ({gameState.players.length}/4)
        </div>
      )}

      {gameState.gameStarted && (
        <div className="game-board">
          {renderBoard()}
          
          <div className="game-controls">
            <div className="dice-section">
              <div className="dice">{gameState.diceValue || '?'}</div>
              <button 
                onClick={rollDice}
                disabled={!gameState.canRoll || gameState.currentTurn !== myPlayerIndex}
                className="button"
              >
                Roll Dice
              </button>
            </div>
            
            <div className="turn-info">
              {gameState.currentTurn === myPlayerIndex 
                ? "Your turn!" 
                : `${gameState.players[gameState.currentTurn]?.name}'s turn`}
            </div>
            
            {gameState.winner !== null && (
              <div className="winner">
                🎉 {gameState.players[gameState.winner]?.name} wins! 🎉
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
