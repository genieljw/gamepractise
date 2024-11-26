import Phaser from "phaser";
import Config from "../Config";
import Player, { Direction } from '../characters/Player';
import io from 'socket.io-client';

export default class PlayingScene extends Phaser.Scene {
  constructor() {
    super("playGame");

    // other players hashmap
    this.otherPlayers = {};

    // Socket.IO 연결 설정
    this.socket = io("ws://localhost:8081");
    this.playerData = null;

    // currentPlayer 이벤트 리스너 설정
    this.socket.on('currentPlayer', (data) => {
      console.log("current player", data);
      this.playerData = data;
    });
  }

  create() {
    // 배경 설정
    this.m_background = this.add.tileSprite(0, 0, Config.width, Config.height, "background").setOrigin(0, 0);

    // 키 설정
    this.m_cursorKeys = this.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
      space: Phaser.Input.Keyboard.KeyCodes.SPACE
    });

    // 마우스 설정
    this.input.on('pointerdown', (pointer)=>{
      const target = {x: pointer.worldX, y: pointer.worldY};    //클릭 위치: 타겟 설정
      this.createBeam(this.m_player.x, this.m_player.y, target);    //내 위치->타겟 빔 생성
      this.socket.emit('shootBeam', {
        x: this.m_player.x,
        y: this.m_player.y,   //발사체 시작 위치(내 위치)
        targetX: target.x,
        targetY: target.y   //발사체 목표 위치(마우스 클릭)
      });
    });

    this.socket.on('shootBeam', (data) =>{
      if(data.playerId !== this.m_player.id){
        this.addBeam(data.x, data.y);
      }
    });

    //그룹 초기화
    this.otherPlayersGroup = this.physics.add.group({
      immovable: true, // 움직이지 않도록 설정
    });

    // currentPlayer 데이터가 있을 경우에만 플레이어 생성
    if (this.playerData) {
      this.setupPlayer(this.playerData);
    } else {
      // 만약 데이터가 아직 없을 경우, 나중에 데이터가 들어올 때 생성하도록 처리
      this.socket.on('currentPlayer', (data) => {
        this.setupPlayer(data);
      });
    }

    // 소켓 리스너 설정
    this.setupSocketListeners();

    // 50ms마다 다른 플레이어의 위치 업데이트
    this.time.addEvent({
      delay: 50,
      callback: this.updateOtherPlayers,
      callbackScope: this,
      loop: true
    });
  }


  //공격 생성 함수
  createBeam(startX, startY, target){
    const beam = this.physics.add.sprite(startX, startY, 'beamTexture');    //시작 위치에서 beamTexture 스프라이트 생성
    this.physics.moveTo(beam, target.x, target.y, 300); // 빔 속도 설정
    this.time.delayedCall(1000, () => beam.destroy()); // 일정 시간 후 제거
    return beam;
  }

  setupPlayer(data) {
    const { playerId, x, y } = data;

    // 현재 플레이어 생성
    this.m_player = this.physics.add.sprite(x, y, "playerTexture");
    this.m_player.setCollideWorldBounds(true); // 월드 경계 충돌
    this.m_player.id = playerId;

    // 충돌 처리 등록
    this.physics.add.collider(
      this.m_player,
      this.otherPlayersGroup,
      this.handlePlayerCollision,
      null,
      this
    );

    // 카메라가 플레이어를 따라가도록 설정
    this.cameras.main.startFollow(this.m_player);

    // 상태 전송 시작
    this.startSendingPlayerData();
  }

  //충돌 처리 함수
  handlePlayerCollision(player1, player2) {
    console.log(`Collision detected between Player ${player1.id} and Player ${player2.id}`);

    // 충돌 시 처리 로직 (통과 방지 설정)
    player1.setVelocity(0, 0); // 현재 플레이어 멈춤
    player2.setVelocity(0, 0); // 상대 플레이어도 멈춤

    // 추가 동작: 충돌 시 애니메이션, 점수 변경 등
  }

  startSendingPlayerData() {
    // 50ms마다 서버로 자신의 상태 전송
    console.log("start sending data");
    this.time.addEvent({
      delay: 50,
      callback: () => {
        if (this.m_player) {
          this.socket.emit('playerMove', {
            x: this.m_player.x,
            y: this.m_player.y
          });
        }
      },
      callbackScope: this,
      loop: true
    });
  }

  update() {
    if (this.m_player) {
      this.handlePlayerMove();

      // 배경 움직임 설정
      this.m_background.setX(this.m_player.x - Config.width / 2);
      this.m_background.setY(this.m_player.y - Config.height / 2);
      this.m_background.tilePositionX = this.m_player.x - Config.width / 2;
      this.m_background.tilePositionY = this.m_player.y - Config.height / 2;
    }
  }

  handlePlayerMove() {
    const PLAYER_SPEED = 160; // 속도 설정
    if (this.m_cursorKeys.left.isDown) {
      this.m_player.setVelocityX(-PLAYER_SPEED);
    } else if (this.m_cursorKeys.right.isDown) {
      this.m_player.setVelocityX(PLAYER_SPEED);
    } else {
      this.m_player.setVelocityX(0);
    }

    if (this.m_cursorKeys.up.isDown) {
      this.m_player.setVelocityY(-PLAYER_SPEED);
    } else if (this.m_cursorKeys.down.isDown) {
      this.m_player.setVelocityY(PLAYER_SPEED);
    } else {
      this.m_player.setVelocityY(0);
    }
  }

  setupSocketListeners() {
    this.socket.on('state', (state) => {
      Object.keys(state).forEach((playerId) => {
        const playerData = state[playerId];
        const { x, y } = playerData;

        // current player는 처리하지 않음
        if (this.m_player && playerId === this.m_player.id) {
          return;
        }

        // 새로운 플레이어 추가
        if (!this.otherPlayers[playerId]) {
          const newPlayer = this.physics.add.image(x, y, 'playerTexture');
          this.otherPlayers[playerId] = newPlayer;

          // 그룹에 추가
          this.otherPlayersGroup.add(newPlayer);

          this.physics.add.collider(this.m_player, newPlayer);
          console.log(`New player added: ${playerId}`);
        }

        // 기존 플레이어의 위치 업데이트
        const player = this.otherPlayers[playerId];
        player.setPosition(x, y);
      });

      // 더 이상 존재하지 않는 플레이어는 제거
      Object.keys(this.otherPlayers).forEach((playerId) => {
        if (!state[playerId]) {
          this.otherPlayers[playerId].destroy();
          delete this.otherPlayers[playerId];
          console.log(`Player removed: ${playerId}`);
        }
      });
    });

    //server->client shootBeam 이벤트 수신(총알 발사 그리기)
    this.socket.on('shootBeam', (data)=>{
      if (data.playerId != this.m_player.id) {    //수신된 발사체 정보가 현재 플레이어가 아닐 때만 화면에 표시(이중 출력 방지)
        this.createBeam(data.x, data.y, {x: data.targetX, y: data.targetY});
        //다른 플레이어의 위치(data.x, data.y) => 발사체 생성
        //발사체는 타겟 위치(data.targetX, data.targetY)를 향해 이동
      }

    });
  }

  updateOtherPlayers() {
    Object.values(this.otherPlayers).forEach((player) => {
      player.setPosition(player.x, player.y);
    });
  }
}