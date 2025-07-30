const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const { v4: uuidv4 } = require('uuid');

const io = new Server(server, {
  path: '/socket.io/',
  transports: ['websocket'], // Force websocket transport
  cors: {
    origin: "*", // Allow all origins for development. Restrict in production.
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Serve a simple index.html for health check or basic web access
app.get('/', (req, res) => {
  res.send('<h1>Remote Control Server is Running</h1><p>Connect via Socket.IO</p>');
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

// Store clients
const clients = {
  androids: new Map(), // Map<socket.id, { socket, deviceName }>
  pcs: new Map()       // Map<socket.id, { socket, selectedAndroidId }>
};

// Function to broadcast the list of connected android devices to all PCs
function broadcastAndroidList() {
  const androidList = Array.from(clients.androids.values()).map(client => ({
    id: client.socket.id,
    deviceName: client.deviceName
  }));
  
  clients.pcs.forEach(pcClient => {
    pcClient.socket.emit('androidList', { devices: androidList });
  });
}

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  console.log(`Total connected clients: ${io.engine.clientsCount}`);

  socket.on('register', (data) => {
    console.log(`Received register event from ${socket.id}:`, data);
    if (data.as === 'android') {
      clients.androids.set(socket.id, { socket, deviceName: data.deviceName || 'Unnamed Device' });
      console.log(`Android client registered: ${socket.id} (${clients.androids.get(socket.id).deviceName})`);
      socket.emit('register', { status: 'success', id: socket.id });
      broadcastAndroidList();
    } else if (data.as === 'pc') {
      clients.pcs.set(socket.id, { socket, selectedAndroidId: null });
      console.log(`PC client registered: ${socket.id}`);
      socket.emit('register', { status: 'success' });
      broadcastAndroidList();
    }
  });

  socket.on('selectAndroid', (data) => {
    console.log(`Received selectAndroid event from ${socket.id}:`, data);
    const pcClient = clients.pcs.get(socket.id);
    if (pcClient) {
      if (clients.androids.has(data.targetId)) {
        pcClient.selectedAndroidId = data.targetId;
        console.log(`PC client ${socket.id} selected Android device: ${data.targetId}`);
        socket.emit('selectionChanged', { selectedId: data.targetId });
      } else {
        socket.emit('error', { message: 'Target Android device not found' });
      }
    }
  });

  socket.on('executeCommand', (data) => {
    console.log(`Received executeCommand event from ${socket.id}:`, data);
    const pcClient = clients.pcs.get(socket.id);
    if (pcClient && pcClient.selectedAndroidId) {
      const targetAndroid = clients.androids.get(pcClient.selectedAndroidId);
      if (targetAndroid) {
        console.log(`Relaying command from PC ${socket.id} to Android ${pcClient.selectedAndroidId}: ${data.type} ${JSON.stringify(data.payload)}`);
        targetAndroid.socket.emit('executeCommand', { type: data.type, payload: data.payload });
      } else {
        socket.emit('error', { message: 'Selected Android device is no longer connected' });
      }
    } else {
      socket.emit('error', { message: 'No Android device selected or PC client not registered' });
    }
  });

  socket.on('showAlert', (data) => {
    console.log(`Received showAlert event from ${socket.id}:`, data);
    const pcClient = clients.pcs.get(socket.id);
    if (pcClient && pcClient.selectedAndroidId) {
      const targetAndroid = clients.androids.get(pcClient.selectedAndroidId);
      if (targetAndroid) {
        console.log(`Relaying alert to Android ${pcClient.selectedAndroidId}: ${data.message}`);
        targetAndroid.socket.emit('showAlert', { message: data.message });
      } else {
        socket.emit('error', { message: 'Selected Android device is no longer connected' });
      }
    } else {
      socket.emit('error', { message: 'No Android device selected or PC client not registered' });
    }
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    console.log(`Total connected clients: ${io.engine.clientsCount}`);
    if (clients.androids.has(socket.id)) {
      const deviceName = clients.androids.get(socket.id).deviceName;
      clients.androids.delete(socket.id);
      console.log(`Android client disconnected: ${socket.id} (${deviceName})`);
      broadcastAndroidList();
    } else if (clients.pcs.has(socket.id)) {
      clients.pcs.delete(socket.id);
      console.log(`PC client disconnected: ${socket.id}`);
    }
  });

  socket.on('error', (error) => {
    console.error(`Socket error for ${socket.id}:`, error);
  });
});
