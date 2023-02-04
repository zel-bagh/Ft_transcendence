import { Injectable } from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { Server, Socket } from 'socket.io';
import { ChatService } from 'src/chat/chat.service';
import { clearInterval } from 'timers';
import { GameInfo } from './utils/gameinfo';

class user{
  id : string;
  piclink : string;
  side : string;
}

export class oneVone {
  inviter: Socket;
  timeoutId:any;
}
@Injectable()
export class GameService {
  constructor(private readonly chatService: ChatService) {
  }
  async handleConnection(client: Socket, queue_normal: Socket[], queue_advanced: Socket[],wss: Server, rooms: string[], ongameclients:Socket[], waitingSpectators: Socket[], oneVone: oneVone[]) 
  {
    client.data.manageDisconnection = "Checking user";

    const userInfo = await this.chatService.getUserFromSocket(client);

    // Storing client's info
    client.data.user = new user();
    client.data.user.id = userInfo.nickname;
    client.data.user.piclink = userInfo.pictureLink;

    if (client.handshake.query.role == "player")
      this.handlePlayerConnection(client, queue_normal, queue_advanced, wss, rooms, ongameclients, waitingSpectators);
    else if (client.handshake.query.role == "spectator")
      this.handleSpectatorConnection(client, rooms, ongameclients, waitingSpectators);
    else if (client.handshake.query.role == "inviting" || client.handshake.query.role == "invited")
      this.handle1v1Connection(client, wss, oneVone, rooms, ongameclients, waitingSpectators);
  }

// 1v1 mode
async handle1v1Connection(client: Socket, wss: Server, oneVone: oneVone[], rooms: string[], ongameclients:Socket[], waitingSpectators: Socket[])
{
  if (client.connected)
  {
    client.data.inGame = false;
    if (client.handshake.query.role == "inviting")
    {
      client.data.manageDisconnection = "Waiting"; 
      // // Set an Interval that search for the invited in all namespaces then sends the invite
      // const intervalId = setInterval(async ()=>
      // {
      //   // Finding the invited and send them the invitation
        const namespace = wss.of('/chat');
        let clients = await namespace.fetchSockets();
        for (const cli of clients)
        {
          if (cli.data.user.id == client.handshake.query.id)
          {
            cli.emit("invited", {Id:client.data.user.id, piclink: client.data.user.piclink});
            break ;
          }
        }
      // }, 1000/2);
      const timeoutId = setTimeout(async () => {
        const index = oneVone.findIndex((cli)=>{return cli.inviter == client});
        oneVone.splice(index, 1);
        client.data.manageDisconnection = "connected"; 
        client.emit("expired");
      }, 10*1000);
      oneVone.push({inviter : client, timeoutId : timeoutId});
      client.data.user.side = "left";
      client.emit("playerInfo", client.data.user);
    }
    else if (client.handshake.query.role == "invited")
    {
      const index = oneVone.findIndex((cli)=>{return (cli.inviter.data.user.id == client.handshake.query.id) && (cli.inviter.handshake.query.id == client.data.user.id)});
      if (index != -1)
      {
        clearTimeout(oneVone[index].timeoutId);
        const first = oneVone[index].inviter;
        const second = client;
        oneVone.splice(index, 1);
        client.data.user.side = "right";
        client.emit("playerInfo", client.data.user);
        this.joinPlayersToGame(first, second, wss, rooms, ongameclients, waitingSpectators);
      }
      else
        client.emit("expired");
    }
  }
}

  //  Spectator mode
  async handleSpectatorConnection(client: Socket, rooms: string[], ongameclients:Socket[], waitingSpectators: Socket[])
  {
    if (client.connected) // Proceed if the client hasn't disconnected
    {
        client.data.manageDisconnection = "Yes";
        client.data.room = "none";
        client.data.last_time = ((new Date()).getTime());
      // Set events
      client.on("next", ()=>
      {
        const time = ((new Date()).getTime());
        if (time - client.data.last_time > 500)
          this.findGame(client, rooms, ongameclients, waitingSpectators)});

       this.findGame(client, rooms, ongameclients, waitingSpectators);
    }
  }
  findGame(client: Socket, rooms:string[], ongameclients:Socket[], waitingSpectators: Socket[])
  {    
    if (client.data.room != "none")
    {
      if (rooms.length !=  1)
      {
        const index = rooms.findIndex((r)=>{
        return(r == client.data.room);
        })
        client.leave(client.data.room)
        if (rooms.length > index + 1)
          this.WatchGame(client, rooms[index+1], ongameclients);
        else
          this.WatchGame(client, rooms[0], ongameclients);
      }
    }
    else if (rooms.length == 0)
    {
      client.emit("noGames");
      client.data.room = "waiting";
      waitingSpectators.push(client);
    }
    else
    {
      /*
        Change state of client to "Spectating"
      */
      this.WatchGame(client, rooms[0], ongameclients);
    }
  }
  WatchGame(client: Socket, room:string, ongameclients:Socket[])
  {
    let id:string[];

    // Get playersInfo and send them
    id = room.split("+");

    let player:Socket = ongameclients.find((cl)=>{if(cl.data.user.id == id[0])return 1;return 0;});
    // console.log(player);
    client.emit("playerInfo", player.data.user);
    player = ongameclients.find((cl)=>{if(cl.data.user.id == id[1])return 1;return 0;});
    client.emit("playerInfo", player.data.user);
    client.data.room = room;
    // Join client to room
    client.join(room);
  }

  // Function handles when player is connected to the firstGateway
  async handlePlayerConnection (client: Socket, queue_normal: Socket[], queue_advanced: Socket[], wss: Server, rooms: string[], ongameclients:Socket[], waitingSpectators: Socket[])
  {    
    if (client.connected) // Proceed if the client hasn't disconnected
    {
      if (client.handshake.query.mode == "normal")
      {
        // If no one is waiting, add client to queue
        if (queue_normal.length == 0)
        {
          client.data.manageDisconnection = "In queue";
          queue_normal.push(client);
          client.emit("queue");
          client.data.user.side = 'left';
          client.emit("playerInfo", client.data.user);
          //AbdLah=============================================================
          /*
          change client.data.user.id  state to "in queue" in database
          */
        }
        else // If someone already in queue join him in a game with client
        {
          client.data.user.side = 'right';
          client.emit("playerInfo", client.data.user);
          const second = client;
          const first = queue_normal.pop();
          ongameclients.push(first, second);
          // Join them
          this.joinPlayersToGame(first, second, wss, rooms, ongameclients, waitingSpectators);
        }
      }
      else if (client.handshake.query.mode == "advanced")
      {
        // If no one is waiting, add client to queue
        if (queue_advanced.length == 0)
        {
          client.data.manageDisconnection = "In queue";
          queue_advanced.push(client);
          client.emit("queue");
          client.data.user.side = 'left';
          client.emit("playerInfo", client.data.user);
          //AbdLah=============================================================
          /*
          change client.data.user.id  state to "in queue" in database
          */
        }
        else // If someone already in queue join him in a game with client
        {
          client.data.user.side = 'right';
          client.emit("playerInfo", client.data.user);
          const second = client;
          const first = queue_advanced.pop();
          ongameclients.push(first, second);
          // Join them
          this.joinPlayersToGame(first, second, wss, rooms, ongameclients, waitingSpectators);
        }
      }
    }
}


  joinPlayersToGame(first: Socket, second: Socket, wss: Server, rooms: string[], ongameclients:Socket[], waitingSpectators: Socket[])
  {
    const roomname = first.data.user.id + '+' + second.data.user.id;
    // Join players to room
    first.join(roomname);
    second.join(roomname);
    first.data.roomname = roomname;
    second.data.roomname = roomname;
    rooms.push(roomname);
    // Set up opponent for both players
    first.data.opponent = second;
    second.data.opponent = first;

    // Create a GameInfo for players
    let gameinfo;
    if (first.handshake.query.mode == "normal")
      gameinfo = new GameInfo("normal");
    else
      gameinfo = new GameInfo("advanced");
    first.data.gameinfo = gameinfo;
    // first.data.gameinfo = gameinfo;
    second.data.gameinfo = first.data.gameinfo;
    // const gameinfo = first.data.gameinfo;

    // Set Key events for both clients
    first.on("keyUp", () => {gameinfo.updatePaddles("left", "up");});
    first.on("keyDown", () => {gameinfo.updatePaddles("left", "down");});
    second.on("keyUp", () => {gameinfo.updatePaddles("right", "up");});
    second.on("keyDown", () => {gameinfo.updatePaddles("right", "down");});

    // AbdeLah ===============================
    /*
      Set both clients state in database to "in game"
        first.data.user.id && second.data.user.id
    */
    // Send opponent info
    first.emit("playerInfo", second.data.user);
    second.emit("playerInfo", first.data.user);

    // Starting game
    const intervalId = setInterval(() => {
      if (gameinfo.update() == false) 
      {
        // Broadcast new cooridnates to players in room
        wss
          .to(roomname)
          .emit('update', gameinfo.coordinates());
      } 
      else 
      {
        if (gameinfo.winner() == "left")
        {
          first.emit("uWon", "left");
          second.emit("uLost", "right");
        }
        else
        {
          first.emit("uLost", "left");
          second.emit("uWon", "right");
        }
        this.gameFinished(first, second, wss, rooms, ongameclients);
      }
    }, 1000/60);
    first.data.gameIntervalId = intervalId;
    second.data.gameIntervalId = intervalId;
    first.data.manageDisconnection = "In game";
    second.data.manageDisconnection = "In game";
    // Join Waiting spectators to room
    waitingSpectators.forEach((cli)=>{
      /*
      Change state of cli to "Spectating"
      */
      this.WatchGame(cli, first.data.roomname, ongameclients);
    })
    waitingSpectators.length = 0;
  }

  async gameFinished(first: Socket, second: Socket, wss: Server, rooms: string[], ongameclients:Socket[])
  {
    clearInterval(first.data.gameIntervalId);
    first.data.manageDisconnection = "After game";
    second.data.manageDisconnection = "After game";

    ongameclients.splice(ongameclients.findIndex((client)=>{return client == first}), 1);
    ongameclients.splice(ongameclients.findIndex((client)=>{return client == second}), 1);

    // Setting result for both users
    if (first.data.gameinfo.leftPaddle.score == first.data.gameinfo.winScore)
    {
      first.data.result = "win";
      second.data.result = "loss";
      first.leave(first.data.roomname);
      second.leave(second.data.roomname);
      wss.to(first.data.roomname).emit("Winner", "left");
    }
    else
    {
      first.data.result = "loss";
      second.data.result = "win";
      first.leave(first.data.roomname);
      second.leave(second.data.roomname);
      wss.to(first.data.roomname).emit("Winner", "right");
    }
    // Kick spectators out of room and Setting  them as not in room anymore
    const sockets = await wss.in(first.data.roomname).fetchSockets();
    for (const socket of sockets)
    {
      /*
        Change state of client to "Online"
      */
      socket.data.room = "none";
      socket.leave(first.data.roomname);
    }
    // Remove this room
    rooms.splice(rooms.findIndex(room => {return first.data.roomname == room}), 1);

    // AbdeLah ============================================
          /*  Add game to users history and their state to "online"
              user 1:{
                id : first.data.user.id
                opponent : second.data.user.id
                result : first.data.result
                score : first.data.gameinfo.leftPaddleScore
                mode : first.handshake.query.mode
              }
              user 2:{
                id : second.data.user.id
                opponent : first.data.user.id
                result : second.data.result
                score : second.data.gameinfo.rightPaddleScore
                mode : second.handshake.query.mode
              }
          */
  }

  async handleDisconnection(wss: Server, client: Socket, queue_normal: Socket[], queue_advanced: Socket[], rooms: string[], ongameclients:Socket[], waitingSpectators: Socket[], oneVone: oneVone[])
  {

    // If client has a spectator role
    if (client.handshake.query.role == "spectator" && client.data.manageDisconnection != "Checking user")
    {
      if (client.data.room == "waiting")
        waitingSpectators.splice(waitingSpectators.findIndex((s)=> {return s == client}), 1);
    }

    // If client has a player role
    if ((client.handshake.query.role == "player" || client.handshake.query.role == "inviting" || client.handshake.query.role == "invited") && client.data.manageDisconnection != "Checking user")
    {
      // Filter queue from client
      if (client.data.manageDisconnection == "In queue")
      {
        if (client.handshake.query.mode == "normal")
          queue_normal.splice(queue_normal.findIndex(clientInQueue => {return clientInQueue == client}), 1);

        else if (client.handshake.query.mode == "advanced")
          queue_advanced.splice(queue_advanced.findIndex(clientInQueue => {return clientInQueue == client}), 1);
      }
      // Filter inviter from oneVone
      else if (client.handshake.query.role == "inviting" &&  client.data.manageDisconnection == "Waiting")
      {
        const idx = oneVone.findIndex(cli=> {return cli.inviter == client});
        const inviter = oneVone.splice(idx, 1);
        clearTimeout(inviter[idx].timeoutId);
        const clients = await wss.of("/chat").fetchSockets();
        for (const cli of clients)
        {
          if (cli.data.user.id == client.handshake.query.id)
          {
            cli.emit("Cancel", client.data.user.id);
            break ;
          }
        }
      }
      // If client is already in game
      else if (client.data.manageDisconnection == "In game")
      {
          client.data.opponent.data.manageDisconnection = "After game";
          clearInterval(client.data.gameIntervalId);
          
          client.data.opponent.emit("OpponentLeft");
          client.data.opponent.leave(client.data.roomname);
          client.leave(client.data.roomname);

          ongameclients.splice(ongameclients.findIndex((cl)=>{return cl == client}, 1));
          ongameclients.splice(ongameclients.findIndex((cl)=>{return cl == client.data.opponent}, 1));

          // For spectators
          if (client.data.user.side == "left")
            wss.to(client.data.roomname).emit("Winner", "right");
          else
            wss.to(client.data.roomname).emit("Winner", "left");
          // Kick spectators out of room and Setting  them as not in room anymore
          const sockets = await wss.in(client.data.roomname).fetchSockets();
          for (const socket of sockets)
          {
            /*
              Change state of client to "Online"
            */
            socket.data.room = "none";
            socket.leave(client.data.roomname);
          }
          // Remove this room
          rooms.splice(rooms.findIndex(room => {return client.data.roomname == room}, 1));

          // AbdeLah ===========================================
          /* Add game to clients history in database
              user 1:{
                id : client.data.user.id
                opponent : client.data.opponent.data.user.id
                result : loss by leaving game
                score : 0
                mode : client.handshake.query.mode
              }
              user 2:{
                id : client.data.opponent.data.user.id
                opponent : client.data.user.id
                result : win opponent left
                score : 5
                mode : client.handshake.query.mode
              }
              set client.data.opponent.data.user.id to "online" in database
          */
      }
    }
  }
}