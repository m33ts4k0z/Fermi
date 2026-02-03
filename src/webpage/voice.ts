import {
	memberjson,
	sdpback,
	streamCreate,
	streamServerUpdate,
	voiceserverupdate,
	voiceStatus,
	webRTCSocket,
} from "./jsontypes.js";

/** Set to ingest URL to enable debug logging; leave empty to avoid ERR_CONNECTION_REFUSED in console. */
const DEBUG_INGEST_URL = "";

function forceVideo(video: HTMLVideoElement) {
	video.addEventListener("pause", () => {
		video.play();
	});
}
class VoiceFactory {
	settings: {id: string};
	handleGateway: (obj: Object) => void;
	secure: boolean;
	streamSettings: {resolution: {width: number; height: number}; bitrate: number} = {
		resolution: {width: 1280, height: 720},
		bitrate: 3000000, // 3 Mbps default
	};
	constructor(
		usersettings: VoiceFactory["settings"],
		handleGateway: VoiceFactory["handleGateway"],
		secure: boolean,
	) {
		this.secure = secure;
		this.settings = usersettings;
		this.handleGateway = handleGateway;
	}
	voices = new Map<string, Map<string, Voice>>();
	voiceChannels = new Map<string, Voice>();
	currentVoice?: Voice;
	guildUrlMap = new Map<
		string,
		{url?: string; token?: string; geturl: Promise<void>; gotUrl: () => void}
	>();
	makeVoice(guildid: string, channelId: string, settings: Voice["settings"]) {
		const gid = String(guildid ?? "");
		let guild = this.voices.get(gid);
		if (!guild) {
			this.setUpGuild(gid);
			guild = new Map();
			this.voices.set(gid, guild);
		}
		if (this.voiceChannels.has(channelId)) {
			const existing = this.voiceChannels.get(channelId)!;
			existing.settings = {...existing.settings, ...settings};
			return existing;
		}
		const urlobj = this.guildUrlMap.get(gid);
		if (!urlobj) throw new Error("url Object doesn't exist (InternalError)");
		const voice = new Voice(this.settings.id, settings, urlobj, this);
		this.voiceChannels.set(channelId, voice);
		guild.set(channelId, voice);
		return voice;
	}
	onJoin = (_voice: Voice) => {};
	onLeave = (_voice: Voice) => {};
	private imute = false;
	video = false;
	stream = false;
	get mute() {
		return this.imute;
	}
	set mute(s) {
		const changed = this.imute !== s;
		this.imute = s;
		if (this.currentVoice && changed) {
			this.currentVoice.updateMute();
			this.updateSelf();
		}
	}
	disconect() {
		if (!this.curChan) return;
		this.curChan = null;
		this.curGuild = null;
		this.handleGateway({
			op: 4,
			d: {
				guild_id: this.curGuild,
				channel_id: this.curChan,
				self_mute: this.imute,
				self_deaf: false,
				self_video: false,
				flags: 3,
			},
		});
	}

	updateSelf() {
		if (this.currentVoice && this.currentVoice.open) {
			this.handleGateway({
				op: 4,
				d: {
					guild_id: this.curGuild,
					channel_id: this.curChan,
					self_mute: this.imute,
					self_deaf: false,
					self_video: this.video,
					flags: 3,
				},
			});
		}
	}
	curGuild: string | null = null;
	curChan: string | null = null;
	joinVoice(channelId: string, guildId: string, self_mute = false) {
		const voice = this.voiceChannels.get(channelId);
		this.mute = self_mute;
		if (this.currentVoice && this.currentVoice.ws) {
			this.currentVoice.leave();
		}
		this.curChan = channelId;
		this.curGuild = guildId;
		if (!voice) throw new Error(`Voice ${channelId} does not exist`);
		voice.join();
		this.currentVoice = voice;
		this.onJoin(voice);
		return {
			d: {
				guild_id: guildId,
				channel_id: channelId,
				self_mute,
				self_deaf: false, //todo
				self_video: false,
				flags: 2, //?????
			},
			op: 4,
		};
	}
	leaveLive() {
		const userid = this.settings.id;
		const stream_key = `${this.curGuild === "@me" ? "call" : `guild:${this.curGuild}`}:${this.curChan}:${userid}`;
		this.handleGateway({
			op: 19,
			d: {
				stream_key,
			},
		});
	}
	live = new Map<string, (res: Voice) => void>();
	steamTokens = new Map<string, Promise<[string, string]>>();
	steamTokensRes = new Map<string, (res: [string, string]) => void>();
	async joinLive(userid: string, guildId?: string, channelId?: string) {
		const g = guildId ?? this.curGuild;
		const c = channelId ?? this.curChan;
		const stream_key = `${g === "@me" ? "call" : `guild:${g}`}:${c}:${userid}`;
		this.handleGateway({
			op: 20,
			d: {
				stream_key,
			},
		});
		return new Promise<Voice>(async (res) => {
			this.live.set(stream_key, res);
			this.steamTokens.set(
				stream_key,
				new Promise<[string, string]>((res) => {
					this.steamTokensRes.set(stream_key, res);
				}),
			);
		});
	}
	islive = false;
	liveStream?: MediaStream;
	async createLive(stream: MediaStream) {
		// #region agent log
		DEBUG_INGEST_URL&&fetch(DEBUG_INGEST_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voice.ts:createLive',message:'createLive called',data:{hasStream:!!stream,trackCount:stream?.getTracks().length,userid:this.settings.id},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H40'})}).catch(()=>{});
		// #endregion
		console.log("createLive called with stream:", stream);
		console.log("Stream tracks:", stream.getTracks());
		const userid = this.settings.id;
		this.islive = true;
		this.liveStream = stream;
		// #region agent log
		DEBUG_INGEST_URL&&fetch(DEBUG_INGEST_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voice.ts:createLive-saved',message:'liveStream saved to this.liveStream',data:{islive:this.islive,hasLiveStream:!!this.liveStream,liveStreamTracks:this.liveStream?.getTracks().length,userid},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H40'})}).catch(()=>{});
		// #endregion
		console.log("liveStream saved, userid:", userid);
		const stream_key = `${this.curGuild === "@me" ? "call" : `guild:${this.curGuild}`}:${this.curChan}:${userid}`;
		this.handleGateway({
			op: 18,
			d: {
				type: this.curGuild === "@me" ? "call" : "guild",
				guild_id: this.curGuild === "@me" ? null : this.curGuild,
				channel_id: this.curChan,
				preferred_region: null,
			},
		});
		this.handleGateway({
			op: 22,
			d: {
				paused: false,
				stream_key,
			},
		});

		const voice = await new Promise<Voice>(async (res) => {
			this.live.set(stream_key, res);
			this.steamTokens.set(
				stream_key,
				new Promise<[string, string]>((res) => {
					this.steamTokensRes.set(stream_key, res);
				}),
			);
		});
		stream.getTracks().forEach((track) =>
			track.addEventListener("ended", () => {
				this.leaveLive();
			}),
		);
		return voice;
	}
	async streamCreate(create: streamCreate) {
		console.log("streamCreate called with:", create.d.stream_key);
		const prom1 = this.steamTokens.get(create.d.stream_key);
		if (!prom1) {
			console.log("Passive stream discovery for key:", create.d.stream_key);
			return;
		}
		const [token, endpoint] = await prom1;
		console.log("Got token and endpoint:", endpoint);
		if (create.d.stream_key.startsWith("guild")) {
			const [_, _guild, chan, user] = create.d.stream_key.split(":");
			console.log("Parsed stream key - chan:", chan, "user:", user);
			const voice2 = this.voiceChannels.get(chan);

			if (!voice2 || !voice2.session_id) {
				console.error("voice2 missing or no session_id", voice2);
				throw new Error("oops");
			}
			if (voice2.voiceMap.has(user)) {
				console.log("voiceMap already has user, making op12");
				// Viewer is reusing channel Voice for stream; set isStreamViewer so op12/updateRemote
				// wait for vidusers and use video SSRC (fixes black screen / "videoSSRC=null").
				if (user !== this.settings.id) {
					voice2.settings.isStreamViewer = true;
				}
				voice2.makeOp12();
				return;
			}
			let stream: undefined | MediaStream = undefined;
			const isStreamViewer = user !== this.settings.id;
			// #region agent log
			DEBUG_INGEST_URL&&fetch(DEBUG_INGEST_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voice.ts:streamServerCreate',message:'streamServerCreate handler running',data:{user,settingsId:this.settings.id,isStreamViewer,hasLiveStream:!!this.liveStream,liveStreamTracks:this.liveStream?.getTracks().length,islive:this.islive},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H41'})}).catch(()=>{});
			// #endregion
			console.log("Checking user match - user:", user, "settings.id:", this.settings.id, "isStreamViewer:", isStreamViewer);
			if (user === this.settings.id) {
				stream = this.liveStream;
				// #region agent log
				DEBUG_INGEST_URL&&fetch(DEBUG_INGEST_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voice.ts:streamServerCreate-setStream',message:'Stream set from liveStream',data:{hasStream:!!stream,streamTracks:stream?.getTracks().length},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H41'})}).catch(()=>{});
				// #endregion
				console.log("Stream set to liveStream:", stream, "has tracks:", stream?.getTracks().length);
			} else {
				// #region agent log
				DEBUG_INGEST_URL&&fetch(DEBUG_INGEST_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voice.ts:streamServerCreate-viewer',message:'User is viewer, stream undefined',data:{user,settingsId:this.settings.id},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H41'})}).catch(()=>{});
				// #endregion
				console.log("User mismatch, stream is undefined (watching someone else's stream)");
			}
			const voice = new Voice(
				this.settings.id,
				{
					bitrate: this.streamSettings.bitrate,
					stream: true,
					resolution: this.streamSettings.resolution,
					isStreamViewer,
				},
				{
					url: endpoint,
					token,
				},
				this,
			);
			voice.join();
			voice.startWS(voice2.session_id, create.d.rtc_server_id);
			let video = false;
			voice.onSatusChange = (e) => {
				// #region agent log
				DEBUG_INGEST_URL&&fetch(DEBUG_INGEST_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voice.ts:onSatusChange',message:'onSatusChange callback fired',data:{event:e,hasStream:!!stream,streamTracks:stream?.getTracks().length,videoFlag:video,isDone:e==="done",willStartVideo:e==="done"&&stream&&!video},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H42'})}).catch(()=>{});
				// #endregion
				console.log("[Stream] onSatusChange event:", e, "stream:", !!stream, "video flag:", video, "streamTracks:", stream?.getTracks().length);
				if (e === "done" && stream && !video) {
					// #region agent log
					DEBUG_INGEST_URL&&fetch(DEBUG_INGEST_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voice.ts:startVideo-call',message:'About to call startVideo',data:{hasStream:!!stream,streamTracks:stream?.getTracks().length},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H42'})}).catch(()=>{});
					// #endregion
					console.log("[Stream] Starting video stream with desktop capture");
					voice.startVideo(stream);
					video = true;
					// #region agent log
					DEBUG_INGEST_URL&&fetch(DEBUG_INGEST_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voice.ts:startVideo-done',message:'startVideo called successfully',data:{videoFlag:video},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H42'})}).catch(()=>{});
					// #endregion
				}
				// After video starts, additional "done" events from ontrack are expected
			};

			voice2.gotStream(voice, user);
			console.warn(voice2);
			const res = this.live.get(create.d.stream_key);
			if (res) res(voice);
		}
	}
	streamServerUpdate(update: streamServerUpdate) {
		const res = this.steamTokensRes.get(update.d.stream_key);
		if (res) res([update.d.token, update.d.endpoint]);
	}
	userMap = new Map<string, Voice>();
	voiceStateUpdate(update: voiceStatus) {
		const prev = this.userMap.get(update.user_id);
		console.log(prev, this.userMap);
		if (update.user_id === this.settings.id && this.liveStream && !update.self_stream) {
			const stream_key = `${this.curGuild === "@me" ? "call" : `guild:${this.curGuild}`}:${this.curChan}:${this.settings.id}`;
			this.handleGateway({
				op: 22,
				d: {
					paused: false,
					stream_key,
				},
			});
		}
		const voiceForChannel = update.channel_id != null ? this.voiceChannels.get(update.channel_id) : undefined;
		if (prev && prev !== voiceForChannel) {
			// Only disconnect when we're sure the user moved/left: either channel_id is null (left)
			// or the update's channel has a different Voice. Don't disconnect when voiceForChannel is
			// undefined (channel not in our map yet) for our own update - avoids closing on race.
			const isOwnStaleLeave =
				update.user_id === this.settings.id &&
				update.channel_id === null &&
				this.curChan !== null;
			const isChannelNotInMap = update.channel_id != null && voiceForChannel === undefined;
			const shouldDisconnect = !isOwnStaleLeave && !(update.user_id === this.settings.id && isChannelNotInMap);
			if (shouldDisconnect) {
				prev.disconnect(update.user_id);
			}
			this.onLeave(prev);
		}
		if (voiceForChannel) {
			this.userMap.set(update.user_id, voiceForChannel);
			voiceForChannel.voiceupdate(update);
		}
	}
	/**
	 * Sync voice state from READY_SUPPLEMENTAL so reconnecting clients don't see ghost users
	 * (users who left while we were disconnected never send VOICE_STATE_UPDATE to us).
	 */
	syncVoiceStateFromSupplemental(guilds: Array<{ voice_states: Array<{ user_id: string; channel_id: string | null }> }>) {
		const channelToUserIds = new Map<string, Set<string>>();
		for (const g of guilds) {
			for (const vs of g.voice_states) {
				if (vs.channel_id) {
					let set = channelToUserIds.get(vs.channel_id);
					if (!set) {
						set = new Set();
						channelToUserIds.set(vs.channel_id, set);
					}
					set.add(vs.user_id);
				}
			}
		}
		for (const [channelId, voice] of this.voiceChannels) {
			const expectedIds = channelToUserIds.get(channelId) ?? new Set<string>();
			for (const userId of [...voice.userids.keys()]) {
				if (userId === this.settings.id) continue;
				if (!expectedIds.has(userId)) {
					voice.disconnect(userId);
					this.userMap.delete(userId);
				}
			}
		}
	}
	private setUpGuild(id: string) {
		const obj: {url?: string; geturl?: Promise<void>; gotUrl?: () => void} = {};
		obj.geturl = new Promise<void>((res) => {
			obj.gotUrl = res;
		});
		this.guildUrlMap.set(id, obj as {geturl: Promise<void>; gotUrl: () => void});
	}
	/** Ensure guild has a url slot so VOICE_SERVER_UPDATE can resolve. Call before waiting for URL. */
	ensureGuild(id: string) {
		if (!this.guildUrlMap.has(id)) this.setUpGuild(id);
	}
	voiceServerUpdate(update: voiceserverupdate) {
		const guildId = String(update.d.guild_id ?? "");
		const obj = this.guildUrlMap.get(guildId);
		if (!obj) {
			console.warn("[voice] VOICE_SERVER_UPDATE for unknown guild", guildId, "(setUpGuild not called yet?)");
			return;
		}
		obj.url = update.d.endpoint;
		obj.token = update.d.token;
		obj.gotUrl();
		console.log("[voice] Voice URL received for guild", guildId);
	}
}
export type voiceStatusStr =
	| "done"
	| "notconnected"
	| "sendingStreams"
	| "conectionFailed"
	| "makingOffer"
	| "startingRTC"
	| "noSDP"
	| "waitingMainWS"
	| "waitingURL"
	| "badWS"
	| "wsOpen"
	| "wsAuth"
	| "left";
class Voice {
	private pstatus: voiceStatusStr = "notconnected";
	public onSatusChange: (e: voiceStatusStr) => unknown = () => {};
	set status(e: voiceStatusStr) {
		console.log("state changed: " + e);
		this.pstatus = e;
		this.onSatusChange(e);
	}
	get status() {
		return this.pstatus;
	}
	readonly userid: string;
	settings: {bitrate: number; stream?: boolean; live?: MediaStream; resolution?: {width: number; height: number}; isStreamViewer?: boolean};
	urlobj: {url?: string; token?: string; geturl?: Promise<void>; gotUrl?: () => void};
	owner: VoiceFactory;
	constructor(
		userid: string,
		settings: Voice["settings"],
		urlobj: Voice["urlobj"],
		owner: VoiceFactory,
	) {
		this.userid = userid;
		this.settings = settings;
		this.urlobj = urlobj;
		this.owner = owner;
	}
	pc?: RTCPeerConnection;
	ws?: WebSocket;
	timeout: number = 30000;
	interval: NodeJS.Timeout = 0 as unknown as NodeJS.Timeout;
	time: number = 0;
	seq: number = 0;
	sendAlive() {
		if (this.ws) {
			this.ws.send(JSON.stringify({op: 3, d: 10}));
		}
	}
	users = new Map<number, string>();
	vidusers = new Map<number, string>();
	/** Store codec payload types from op12 for building SDP with correct PTs */
	codecInfo: { video_pt?: number; rtx_pt?: number; audio_pt?: number } = {};
	readonly speakingMap = new Map<string, number>();
	onSpeakingChange = (_userid: string, _speaking: number) => {};
	disconnect(userid: string) {
		console.warn(userid);
		if (userid === this.userid) {
			this.leave();
		}
		const ssrc = this.speakingMap.get(userid);

		if (ssrc) {
			this.users.set(ssrc, "");
			for (const thing of this.ssrcMap) {
				if (thing[1] === ssrc) {
					this.ssrcMap.delete(thing[0]);
				}
			}
		}
		this.speakingMap.delete(userid);
		this.userids.delete(userid);
		console.log(this.userids, userid);
		//there's more for sure, but this is "good enough" for now
		this.onMemberChange(userid, false);
	}

	async packet(message: MessageEvent) {
		const data = message.data;
		if (typeof data === "string") {
			const json: webRTCSocket = JSON.parse(data);
			switch (json.op) {
				case 2:
					this.startWebRTC();
					break;
				case 4:
					this.continueWebRTC(json);
					break;
				case 5:
					this.speakingMap.set(json.d.user_id, json.d.speaking);
					this.onSpeakingChange(json.d.user_id, json.d.speaking);
					break;
				case 6:
					this.time = json.d.t;
					setTimeout(this.sendAlive.bind(this), this.timeout);
					break;
				case 8:
					this.timeout = json.d.heartbeat_interval;
					setTimeout(this.sendAlive.bind(this), 1000);
					break;
				case 12:
					// #region agent log
					DEBUG_INGEST_URL&&fetch(DEBUG_INGEST_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voice.ts:op12',message:'Received op12 from server',data:{user_id:json.d.user_id,audio_ssrc:json.d.audio_ssrc,video_ssrc:json.d.video_ssrc,rtx_ssrc:json.d.rtx_ssrc,video_pt:json.d.video_pt,rtx_pt:json.d.rtx_pt,audio_pt:json.d.audio_pt,streams:json.d.streams,isStream:this.settings.stream,existingVidusers:[...this.vidusers]},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H1'})}).catch(()=>{});
					// #endregion

					// Store codec payload types from server for building SDP with matching PTs
					if (json.d.video_pt !== undefined) this.codecInfo.video_pt = json.d.video_pt;
					if (json.d.rtx_pt !== undefined) this.codecInfo.rtx_pt = json.d.rtx_pt;
					if (json.d.audio_pt !== undefined) this.codecInfo.audio_pt = json.d.audio_pt;

					// For stream viewers: set up vidusers IMMEDIATELY (before figureRecivers delay)
					// so that the SDP negotiation can complete quickly and receive the keyframe
					if (this.settings.isStreamViewer && json.d.video_ssrc && json.d.user_id !== this.userid) {
						const minimal =
							(typeof (globalThis as unknown as { __minimalStreamViewer?: boolean }).__minimalStreamViewer === "boolean"
								? (globalThis as unknown as { __minimalStreamViewer?: boolean }).__minimalStreamViewer
								: (typeof (window as unknown as { __minimalStreamViewer?: boolean }).__minimalStreamViewer === "boolean"
									? (window as unknown as { __minimalStreamViewer?: boolean }).__minimalStreamViewer
									: false));
						const transceivers = this.pc?.getTransceivers() ?? [];
						const videoCount = transceivers.filter((t) => (t as any).kind === "video").length;
						const isMinimalLayout =
							minimal &&
							((transceivers.length === 1 && videoCount === 1) || (transceivers.length === 2 && videoCount === 1));

						// Minimal stream mode: reuse existing transceiver(s) — video only or audio+video
						if (isMinimalLayout && this.pc) {
							const transceiversList = this.pc.getTransceivers();
							const audioTrans = transceiversList.find((t) => (t as any).kind === "audio");
							const videoTrans = transceiversList.find((t) => (t as any).kind === "video");
							if (json.d.audio_ssrc && audioTrans) {
								this.users.set(json.d.audio_ssrc, json.d.user_id);
								audioTrans.direction = "recvonly";
							}
							if (json.d.video_ssrc && videoTrans) {
								this.vidusers.set(json.d.video_ssrc, json.d.user_id);
								videoTrans.direction = "recvonly";
							}
							console.log("[Voice] Minimal stream: reusing transceiver(s) for producer", json.d.user_id, "videoOnly:", transceivers.length === 1);
							// If counter (server SDP) arrived before op12, we skipped setRemoteDescription earlier.
							// Now that vidusers has the producer SSRC, set the answer so RTP is routed to the video receiver.
							if (this.pc && this.counter && this.vidusers.size > 0 && this.pc.signalingState === "have-local-offer") {
								console.log("[voice] op12 (minimal): calling updateRemote vidusers.size=" + this.vidusers.size);
								this.updateRemote().catch((err) => console.warn("[voice] updateRemote after op12 (minimal):", err));
							}
							break;
						}

						// #region agent log
						DEBUG_INGEST_URL&&fetch(DEBUG_INGEST_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voice.ts:op12-streamViewer-immediate',message:'Stream viewer processing op12 immediately (before figureRecivers)',data:{producer:json.d.user_id,video_ssrc:json.d.video_ssrc,audio_ssrc:json.d.audio_ssrc,video_pt:this.codecInfo.video_pt,rtx_pt:this.codecInfo.rtx_pt},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H8'})}).catch(()=>{});
						// #endregion
						
						// Stream viewer: offer has 1 video transceiver (or 1 audio + 1 video). Reuse and set vidusers/users.
						const videoTransceivers = this.pc?.getTransceivers().filter((t) => (t as any).kind === "video") ?? [];
						const hasExistingVideo = videoTransceivers.length >= 1;
						
						if (hasExistingVideo) {
							// Reuse existing transceivers: set vidusers (and users if we have audio)
							if (this.pc && json.d.audio_ssrc) {
								this.users.set(json.d.audio_ssrc, json.d.user_id);
								const audioTrans = this.pc.getTransceivers().find((t) => (t as any).kind === "audio");
								if (audioTrans) audioTrans.direction = "recvonly";
							}
							if (this.pc && json.d.video_ssrc) {
								this.vidusers.set(json.d.video_ssrc, json.d.user_id);
								const firstVideoTrans = videoTransceivers[0];
								if (firstVideoTrans) firstVideoTrans.direction = "recvonly";
							}
						} else {
							// No video transceivers yet (shouldn't happen for stream viewer): add as before
							if (this.pc && json.d.audio_ssrc) {
								this.users.set(json.d.audio_ssrc, json.d.user_id);
								this.pc.addTransceiver("audio", {
									direction: "recvonly",
									sendEncodings: [{active: true}],
								});
								const t = this.getLastAudioTrans();
								if (t) t.direction = "recvonly";
							}
							if (this.pc && json.d.video_ssrc) {
								this.vidusers.set(json.d.video_ssrc, json.d.user_id);
								this.pc.addTransceiver("video", {
									direction: "recvonly",
									sendEncodings: [{active: true}],
								});
								const t = this.getLastVideoTrans();
								if (t) t.direction = "recvonly";
							}
						}
						// If counter arrived before op12, we skipped setRemoteDescription earlier. Set it now.
						if (this.pc && this.counter && this.vidusers.size > 0 && this.pc.signalingState === "have-local-offer") {
							console.log("[voice] op12 (stream viewer): calling updateRemote vidusers.size=" + this.vidusers.size);
							this.updateRemote().catch((err) => console.warn("[voice] updateRemote after op12 (stream viewer):", err));
						}
						// Don't call figureRecivers or makeOp12 for stream viewers - they just receive
						break;
					}

					// For non-stream-viewer connections (regular voice, streamers), use original flow
					await this.figureRecivers();
					if (
						(!this.users.has(json.d.audio_ssrc) && json.d.audio_ssrc !== 0) ||
						(!this.vidusers.has(json.d.video_ssrc) && json.d.video_ssrc !== 0)
					) {
						console.log("redo 12!");
						this.makeOp12();
					}
					if (this.pc && json.d.audio_ssrc) {
						// Set users BEFORE addTransceiver to avoid race condition
						this.users.set(json.d.audio_ssrc, json.d.user_id);
						this.pc.addTransceiver("audio", {
							direction: "recvonly",
							sendEncodings: [{active: true}],
						});
						const t = this.getLastAudioTrans();
						if (t) t.direction = "recvonly";
					}
					if (this.pc && json.d.video_ssrc) {
						// Set vidusers BEFORE addTransceiver to avoid race condition
						// addTransceiver triggers negotiation which calls cleanServerSDP
						// cleanServerSDP needs vidusers to be populated to build correct SDP
						this.vidusers.set(json.d.video_ssrc, json.d.user_id);
						// #region agent log
						DEBUG_INGEST_URL&&fetch(DEBUG_INGEST_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voice.ts:op12-vidusers',message:'Added video_ssrc to vidusers BEFORE addTransceiver',data:{video_ssrc:json.d.video_ssrc,user_id:json.d.user_id,vidusersAfter:[...this.vidusers]},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H1'})}).catch(()=>{});
						// #endregion
						this.pc.addTransceiver("video", {
							direction: "recvonly",
							sendEncodings: [{active: true}],
						});
						const t = this.getLastVideoTrans();
						if (t) t.direction = "recvonly";
					}

					break;
			}
		}
	}
	/** Returns the last video transceiver (the one most recently added). */
	getLastVideoTrans(): RTCRtpTransceiver | undefined {
		if (!this.pc) return undefined;
		const video = [...this.pc.getTransceivers()].filter((t) => (t as any).kind === "video");
		return video.length ? video[video.length - 1] : undefined;
	}
	/** Returns the last audio transceiver (the one most recently added). */
	getLastAudioTrans(): RTCRtpTransceiver | undefined {
		if (!this.pc) return undefined;
		const audio = [...this.pc.getTransceivers()].filter((t) => (t as any).kind === "audio");
		return audio.length ? audio[audio.length - 1] : undefined;
	}
	hoffer?: string;
	get offer() {
		return this.hoffer;
	}
	set offer(e: string | undefined) {
		this.hoffer = e;
	}
	fingerprint?: string;
	async cleanServerSDP(sdp: string): Promise<string> {
		// #region agent log
		DEBUG_INGEST_URL&&fetch(DEBUG_INGEST_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voice.ts:cleanServerSDP-entry',message:'cleanServerSDP called',data:{isStream:this.settings.stream,vidusers:[...this.vidusers],users:[...this.users]},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H2'})}).catch(()=>{});
		// #endregion
		const out = await this.getCamInfo();
		if (out.video_ssrc) {
			this.vidusers.set(out.video_ssrc, this.userid);
			console.log(out);
		} else {
			const i = [...this.vidusers].findIndex((_) => _[1] === this.userid);
			this.vidusers.delete(i);
		}
		const pc = this.pc;
		if (!pc) throw new Error("pc isn't defined");
		const ld = pc.localDescription;
		if (!ld) throw new Error("localDescription isn't defined");
		const parsed = Voice.parsesdp(ld.sdp);
		const group = parsed.atr.get("group");
		console.warn(parsed);
		if (!group) throw new Error("group isn't in sdp");
		const [_, ...bundles] = (group.entries().next().value as [string, string])[0].split(" ");
		bundles[bundles.length - 1] = bundles[bundles.length - 1].replace("\r", "");
		console.log(bundles);

		if (!this.offer) throw new Error("Offer is missing :P");
		let cline = sdp.split("\n").find((line) => line.startsWith("c="));
		if (!cline) throw new Error("c line wasn't found");
		const parsed1 = Voice.parsesdp(sdp).medias[0];
		//const parsed2=Voice.parsesdp(this.offer);
		const rtcport = (parsed1.atr.get("rtcp") as Set<string>).values().next().value as string;
		const ICE_UFRAG = (parsed1.atr.get("ice-ufrag") as Set<string>).values().next().value as string;
		const ICE_PWD = (parsed1.atr.get("ice-pwd") as Set<string>).values().next().value as string;
		const FINGERPRINT =
			this.fingerprint ||
			((parsed1.atr.get("fingerprint") as Set<string>).values().next().value as string);
		this.fingerprint = FINGERPRINT;
		const candidate = (parsed1.atr.get("candidate") as Set<string>).values().next().value as string;

		const audioUsers = [...this.users];
		const videoUsers = [...this.vidusers];
		// When vidusers is empty (answer applied before op12, or isStreamViewer never set), we'd build no video SSRC.
		// The receiver would then not expect Mediasoup's SSRC and only the first keyframe might get through.
		// Always parse the raw server answer for the first video m-line's SSRC when we have no vidusers — do not rely on isStreamViewer (it can be undefined if viewer joined via a path that didn't set it).
		let serverVideoSsrc: number | undefined;
		if (videoUsers.length === 0 && sdp) {
			try {
				const serverParsed = Voice.parsesdp(sdp);
				const firstVideoMedia = serverParsed.medias.find((m) => m.media === "video");
				const ssrcSet = firstVideoMedia?.atr.get("ssrc");
				if (ssrcSet && ssrcSet.size > 0) {
					const first = [...ssrcSet][0];
					const ssrcNum = parseInt(String(first).trim().split(/\s+/)[0], 10);
					if (!isNaN(ssrcNum)) {
						serverVideoSsrc = ssrcNum;
						console.log("[voice] cleanServerSDP: preserving server video SSRC for stream viewer (vidusers empty):", serverVideoSsrc);
					}
				}
				// Fallback: sdp-transform or other writers may use "a=ssrc:12345" or "a=ssrc 12345" in the video section
				if (serverVideoSsrc == null) {
					const sdpNorm = sdp.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
					const videoSection = sdpNorm.split(/\nm=video\b/)[1];
					if (videoSection) {
						const match = videoSection.match(/a=ssrc[:\s]+(\d+)/);
						if (match) {
							serverVideoSsrc = parseInt(match[1], 10);
							console.log("[voice] cleanServerSDP: preserved server video SSRC (regex fallback):", serverVideoSsrc);
						}
					}
				}
			} catch (e) {
				console.warn("[voice] cleanServerSDP: failed to parse server video SSRC", e);
			}
		}
		console.warn(audioUsers);

		// Extract extmap lines from local SDP to copy into built SDP
		// These are REQUIRED for BUNDLE demux (especially the MID extension)
		// BUG FIX: The regex matches ALL extmaps from entire SDP (across all m-lines),
		// causing duplicates like "a=extmap:2" appearing 3+ times. Deduplicate by ID.
		const allExtmaps = ld.sdp.match(/a=extmap:[^\r\n]+/g) || [];
		const seenExtmapIds = new Set<string>();
		let localExtmaps: string[] = [];
		
		// MEDIASOUP COMPATIBILITY: Only allow extmaps that mediasoup understands
		// Chrome adds many extra extensions that mediasoup filters out, causing mismatches
		const allowedExtmapUris = new Set([
			'urn:ietf:params:rtp-hdrext:sdes:mid',                                           // MID (required for BUNDLE)
			'http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01',    // transport-cc
			'http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time',                   // abs-send-time
			'urn:ietf:params:rtp-hdrext:sdes:rtp-stream-id',                                // rid (simulcast)
			'urn:ietf:params:rtp-hdrext:sdes:repaired-rtp-stream-id',                       // repaired-rid
			'urn:ietf:params:rtp-hdrext:ssrc-audio-level',                                  // audio level
			'urn:ietf:params:rtp-hdrext:toffset',                                           // timestamp offset
		]);
		
		for (const ext of allExtmaps) {
			// Extract the ID (e.g., "2" from "a=extmap:2 http://...")
			const idMatch = ext.match(/^a=extmap:(\d+)/);
			if (idMatch && !seenExtmapIds.has(idMatch[1])) {
				// For stream viewers: filter to only mediasoup-compatible extensions
				if (this.settings.isStreamViewer) {
					const uriMatch = ext.match(/a=extmap:\d+\s+(\S+)/);
					const uri = uriMatch?.[1];
					if (uri && !allowedExtmapUris.has(uri)) {
						console.log('[voice] Filtering out unsupported extmap for stream viewer:', ext);
						continue; // Skip this extmap
					}
				}
				seenExtmapIds.add(idMatch[1]);
				localExtmaps.push(ext);
			}
		}
		console.log('Extracted extmap lines from local SDP:', allExtmaps.length, '-> filtered/deduplicated:', localExtmaps.length);

		let build = `v=0\r
o=- 1420070400000 0 IN IP4 ${this.urlobj.url}\r
s=-\r
t=0 0\r
a=msid-semantic: WMS *\r
a=group:BUNDLE ${bundles.join(" ")}\r`;
		// For stream viewers: start at 0 so the first audio/video m-line gets the producer's SSRC
		// For regular users: start at -1 to skip their own outgoing m-line
		let ai = this.settings.isStreamViewer ? 0 : -1;
		let vi = this.settings.isStreamViewer ? 0 : -1;
		let i = 0;
		let usedServerVideoSsrc = false; // use serverVideoSsrc only for the first video m-line we build
		for (const grouping of parsed.medias) {
			const cur =
				([...grouping.atr]
					.map((_) => _[0].trim())
					.find((_) =>
						new Set(["inactive", "recvonly", "sendonly", "sendrecv"]).has(_),
					) as "inactive") ||
				"recvonly" ||
				"sendonly" ||
				"sendrecv";
			const mode = {
				inactive: "inactive",
				recvonly: "sendonly",
				sendonly: "recvonly",
				sendrecv: "sendrecv",
			}[cur];
			if (grouping.media === "audio") {
				const port = [...grouping.ports][0];
				build += `
m=audio ${parsed1.port} UDP/TLS/RTP/SAVPF ${port}\r
${cline}\r
a=rtpmap:${port} opus/48000/2\r
a=fmtp:${port} minptime=10;useinbandfec=1;usedtx=1\r
a=rtcp:${rtcport}\r
a=rtcp-fb:${port} transport-cc\r
a=setup:passive\r
a=mid:${bundles[i]}${audioUsers[ai] && audioUsers[ai][1] ? `\r\na=msid:${audioUsers[ai][1]}-${audioUsers[ai][0]} a${audioUsers[ai][1]}-${audioUsers[ai][0]}\r` : "\r"}
a=maxptime:60\r
a=${audioUsers[ai] && audioUsers[ai][1] ? "sendonly" : mode}\r
a=ice-ufrag:${ICE_UFRAG}\r
a=ice-pwd:${ICE_PWD}\r
a=fingerprint:${FINGERPRINT}\r
a=candidate:${candidate}${audioUsers[ai] && audioUsers[ai][1] ? `\r\na=ssrc:${audioUsers[ai][0]} cname:${audioUsers[ai][1]}-${audioUsers[ai][0]}\r` : "\r"}
a=rtcp-mux\r`;
				// Add extmap lines from local SDP (REQUIRED for BUNDLE demux)
				for (const extmap of localExtmaps) {
					build += `\n${extmap}\r`;
				}
				console.log(audioUsers[ai], "audio user");
				ai++;
			} else {
				// For stream viewers: extra video m-lines as inactive (answer must match offer m-line count)
				if (this.settings.isStreamViewer && vi > 0) {
					build += `
m=video 0 UDP/TLS/RTP/SAVPF 0\r
${cline}\r
a=mid:${bundles[i]}\r
a=inactive\r`;
					vi++;
					i++;
					continue;
				}
				// For stream viewers: use the server's codecInfo PTs directly.
				// The server tells us exactly which H264 PT and RTX PT mediasoup will use.
				// These PTs must match what's in Chrome's offer, and the server ensures this.
				// For non-viewers: parse from offer as before.
				let port1 = "";
				let port2 = "";
				if (this.settings.isStreamViewer && this.codecInfo.video_pt) {
					// Stream viewer: trust server's codec info
					port1 = String(this.codecInfo.video_pt);
					port2 = this.codecInfo.rtx_pt ? String(this.codecInfo.rtx_pt) : "";
					console.log("[voice] Stream viewer using server codecInfo: video_pt=" + port1 + " rtx_pt=" + port2);
				} else {
					// Non-viewer: parse H264 and its associated RTX from offer
					const rtpmapSet = grouping.atr.get("rtpmap") || new Set();
					const fmtpSet = grouping.atr.get("fmtp") || new Set();
					
					// Find H264 with profile 42e01f (baseline) - this is what mediasoup uses
					// First, try to find the preferred profile
					let fallbackH264 = "";
					for (const thing of rtpmapSet) {
						if (thing.includes("H264/90000")) {
							const pt = thing.split(" ")[0];
							// Save first H264 as fallback
							if (!fallbackH264) fallbackH264 = pt;
							// Check if this PT has profile 42e01f
							for (const fmtp of fmtpSet) {
								if (fmtp.startsWith(pt + " ") && fmtp.includes("profile-level-id=42e01f")) {
									port1 = pt;
									break;
								}
							}
							if (port1) break; // Found preferred profile, stop
						}
					}
					// If no 42e01f found, use fallback
					if (!port1 && fallbackH264) port1 = fallbackH264;
					
					// Find RTX with apt matching our H264
					if (port1) {
						for (const fmtp of fmtpSet) {
							if (fmtp.includes("apt=" + port1)) {
								port2 = fmtp.split(" ")[0];
								break;
							}
						}
					}
				}

				// Build video m-line - only include RTX if port2 is set
				const videoPayloads = port2 ? `${port1} ${port2}` : port1;
				const rtxRtpmap = port2 ? `a=rtpmap:${port2} rtx/90000\r\n` : "";
				const rtxFmtp = port2 ? `a=fmtp:${port2} apt=${port1}\r\n` : "";
				
				// First video m-line: use vidusers if set, else server answer's video SSRC (vi can be -1 when isStreamViewer undefined)
				const haveViduser = videoUsers[vi] && videoUsers[vi][1];
				let videoSsrcForBuild: { ssrc: number; cname: string } | null = haveViduser
					? { ssrc: videoUsers[vi][0], cname: `${videoUsers[vi][1]}-${videoUsers[vi][0]}` }
					: (serverVideoSsrc != null && !usedServerVideoSsrc)
						? (usedServerVideoSsrc = true, { ssrc: serverVideoSsrc, cname: `stream-${serverVideoSsrc}` })
						: null;
				build += `
m=video ${parsed1.port} UDP/TLS/RTP/SAVPF ${videoPayloads}\r
${cline}\r
a=rtpmap:${port1} H264/90000\r
${rtxRtpmap}a=fmtp:${port1} level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f\r
${rtxFmtp}a=rtcp:${rtcport}\r
a=rtcp-fb:${port1} ccm fir\r
a=rtcp-fb:${port1} nack\r
a=rtcp-fb:${port1} nack pli\r
a=rtcp-fb:${port1} goog-remb\r
a=rtcp-fb:${port1} transport-cc\r
a=setup:passive\r
a=mid:${bundles[i]}${videoSsrcForBuild ? `\r\na=msid:${videoSsrcForBuild.cname} v${videoSsrcForBuild.cname}\r` : "\r"}
a=${videoSsrcForBuild ? "sendonly" : mode}\r
a=ice-ufrag:${ICE_UFRAG}\r
a=ice-pwd:${ICE_PWD}\r
a=fingerprint:${FINGERPRINT}\r
a=candidate:${candidate}${videoSsrcForBuild ? `\r\na=ssrc:${videoSsrcForBuild.ssrc} cname:${videoSsrcForBuild.cname}\r` : "\r"}
a=rtcp-mux\r`;
				// Add extmap lines from local SDP (REQUIRED for BUNDLE demux)
				for (const extmap of localExtmaps) {
					build += `\n${extmap}\r`;
				}
				vi++;
				console.log(mode, "fine me :3");
			}
			i++;
		}
		build += "\n";
		console.log(ld.sdp, "fime :3", build, this.pc?.remoteDescription?.sdp);
		
		// Extract video m-line for logging (get FULL first video m-line, not truncated)
		const videoMlines = build.split('\nm=video').slice(1).map(s => 'm=video' + s.split('\nm=')[0]);
		// Check for extmap lines in original server SDP  
		const serverExtmaps = sdp.match(/a=extmap:[^\r\n]+/g) || [];
		// Check if SSRC line is in first video m-line
		const firstVideoSsrcMatch = videoMlines[0]?.match(/a=ssrc:(\d+)/);
		
		// #region agent log
		DEBUG_INGEST_URL&&fetch(DEBUG_INGEST_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voice.ts:cleanServerSDP-exit',message:'cleanServerSDP built SDP',data:{isStream:this.settings.stream,isStreamViewer:this.settings.isStreamViewer,codecInfo:this.codecInfo,videoUsers:[...this.vidusers],videoMlineCount:videoMlines.length,firstVideoMlineFull:videoMlines[0],firstVideoSsrc:firstVideoSsrcMatch?.[1],serverExtmapCount:serverExtmaps.length,serverExtmaps:serverExtmaps.slice(0,5),localExtmapCount:localExtmaps.length,localExtmaps:localExtmaps.slice(0,10),builtSdpHasExtmap:build.includes('a=extmap')},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H33'})}).catch(()=>{});
		// #endregion
		return build;
	}
	counter?: string;
	forceNext: boolean = false;
	hasReceivedProducerOp12: boolean = false;
	/** Prevents concurrent updateRemote() so we never setRemoteDescription twice. */
	private _updateRemoteInProgress: boolean = false;
	/** Extract a=mid values in SDP order (one per m= section). */
	private static getMidOrder(sdp: string): string[] {
		const mids: string[] = [];
		const re = /a=mid:(\S+)/g;
		let m: RegExpExecArray | null;
		while ((m = re.exec(sdp)) !== null) mids.push(m[1].trim());
		return mids;
	}
	async updateRemote() {
		const counter = this.counter;
		if (!counter || !this.pc) return;

		// Only apply remote answer when we are waiting for it. Check BEFORE any await
		// to avoid race where another updateRemote() already applied the answer.
		if (this.pc.signalingState !== "have-local-offer") {
			console.warn("[voice] updateRemote: skip (early), signalingState=" + this.pc.signalingState);
			return;
		}
		// Prevent concurrent updateRemote(); second call returns immediately.
		if (this._updateRemoteInProgress) {
			console.warn("[voice] updateRemote: skip (already in progress)");
			return;
		}
		this._updateRemoteInProgress = true;
		try {
			// Stream viewers: do NOT wait for vidusers before setRemoteDescription.
			// op12 is sent by the server only after transport is connected, and transport connects only after client sets the answer (ICE). So we must set the answer first; op12 will arrive after.

			const offerSdpAtStart = this.pc.localDescription!.sdp;
			const remote: {sdp: string; type: RTCSdpType} = {
				sdp: await this.cleanServerSDP(counter),
				type: "answer",
			};
			// Re-check signaling state after await; another call may have applied the answer.
			if (this.pc.signalingState !== "have-local-offer") {
				console.warn("[voice] updateRemote: skip (after cleanServerSDP), signalingState=" + this.pc.signalingState);
				return;
			}
			// Runtime evidence: confirm video SSRC is in the answer we're about to set (server sends ~5MB; viewer must expect correct SSRC or only 1 frame shows)
			const videoSsrcFromVidusers = this.settings.isStreamViewer && this.vidusers.size > 0 ? [...this.vidusers][0][0] : null;
			const answerVideoSsrcMatch = remote.sdp.match(/a=ssrc:(\d+)/);
			const videoSsrcInAnswer = answerVideoSsrcMatch ? parseInt(answerVideoSsrcMatch[1], 10) : null;
			const hasVideoSsrc = videoSsrcInAnswer != null;
			console.log("[voice] setRemoteDescription: isStreamViewer=" + this.settings.isStreamViewer + " videoSSRC in answer=" + videoSsrcInAnswer + " (from vidusers=" + videoSsrcFromVidusers + ") signalingState=" + this.pc.signalingState);
			if (this.settings.isStreamViewer && !hasVideoSsrc) {
				console.warn("[voice] setRemoteDescription: NO video SSRC in built answer — viewer will only decode first keyframe; server RTP will be ignored.");
			}
			console.log([remote.sdp, this.pc.localDescription?.sdp]);

			// Answer m-line count must match offer
			const offerMCount = (this.pc.localDescription?.sdp.match(/^m=/gm) || []).length;
			const answerMCount = (remote.sdp.match(/^m=/gm) || []).length;
			if (offerMCount !== answerMCount) {
				console.warn("[voice] updateRemote: skipping setRemoteDescription, m-line count mismatch offer=" + offerMCount + " answer=" + answerMCount);
				return;
			}
			// Answer m-line ORDER (mid) must match offer or browser throws InvalidAccessError
			const offerMids = Voice.getMidOrder(this.pc.localDescription!.sdp);
			const answerMids = Voice.getMidOrder(remote.sdp);
			if (offerMids.length !== answerMids.length || offerMids.some((mid, i) => mid !== answerMids[i])) {
				console.warn("[voice] updateRemote: skipping setRemoteDescription, m-line order mismatch offerMids=" + JSON.stringify(offerMids) + " answerMids=" + JSON.stringify(answerMids));
				return;
			}
			// Final guard: only set remote answer when still waiting for it (avoids "wrong state: stable")
			if (this.pc.signalingState !== "have-local-offer") {
				console.warn("[voice] updateRemote: skipping setRemoteDescription (state changed), signalingState=" + this.pc.signalingState);
				return;
			}
			// Guard: offer must not have been replaced (e.g. negotiationneeded) or answer m-line order would mismatch
			if (this.pc.localDescription?.sdp !== offerSdpAtStart) {
				console.warn("[voice] updateRemote: skip (offer changed since start), re-sending current offer (op1) so server can answer it");
				this.sendCurrentOfferToServer();
				return;
			}
			try {
				await this.pc.setRemoteDescription(remote);
				console.log("[voice] setRemoteDescription done, new signalingState=" + this.pc.signalingState);
				// #region agent log
				const transceivers = this.pc.getTransceivers().map((t, idx) => ({idx,mid:t.mid,kind:t.receiver.track?.kind,direction:t.direction,currentDirection:t.currentDirection,receiverTrackId:t.receiver.track?.id,receiverTrackEnabled:t.receiver.track?.enabled,receiverTrackMuted:t.receiver.track?.muted,receiverTrackReadyState:t.receiver.track?.readyState}));
				DEBUG_INGEST_URL&&fetch(DEBUG_INGEST_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voice.ts:updateRemote-afterSetRemote',message:'Transceivers after setRemoteDescription',data:{isStreamViewer:this.settings.isStreamViewer,signalingState:this.pc.signalingState,transceivers,offerMids:Voice.getMidOrder(this.pc.localDescription!.sdp),answerMids:Voice.getMidOrder(remote.sdp),answerSsrcs:(remote.sdp.match(/a=ssrc:\d+/g)||[]).map((s:string)=>s.replace('a=ssrc:','')),vidusers:[...this.vidusers]},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H52'})}).catch(()=>{});
				// #endregion
			} catch (err) {
				const errMsg = err instanceof Error ? err.message : String(err);
				console.error("[voice] setRemoteDescription failed:", errMsg, err);
				// #region agent log
				DEBUG_INGEST_URL&&fetch(DEBUG_INGEST_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voice.ts:updateRemote-setRemoteFailed',message:'setRemoteDescription FAILED',data:{error:String(err),isStreamViewer:this.settings.isStreamViewer,signalingState:this.pc.signalingState,remoteSdpPreview:remote.sdp.substring(0,500)},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H52'})}).catch(()=>{});
				// #endregion
				return;
			}
			// Streamer: move from "sendingStreams" to "done" as soon as we apply the viewer's answer
			if ((this.pc.signalingState as string) === "stable" && this.settings.stream) {
				this.status = "done";
			}
		} finally {
			this._updateRemoteInProgress = false;
		}
	}
	negotationneeded() {
		if (this.pc) {
			const pc = this.pc;
			let setting = false;
			const setLocal = async (forced: boolean = this.forceNext) => {
				if (setting) return;
				const val = (Math.random() * 1000) ^ 0;

				setting = true;
				const offer = await pc.createOffer();
				if (offer.sdp === pc.localDescription?.sdp || forced) {
					if (forced) console.log("foced :3");
					logState("update", "will Sent offer " + val);
					await pc.setLocalDescription();
					logState("update", "Sent offer " + val);
				}
				setting = false;
				this.forceNext = false;
			};
			const sendOffer = async (forced = this.forceNext) => {
				if (!setting) {
					setLocal(forced);
					console.log("set local");
				}

				const senders = this.senders.difference(this.ssrcMap);
				let made12 = false;
				for (const sender of senders) {
					const d = await sender.getStats();
					let found = false;
					d.forEach((thing) => {
						if (thing.ssrc) {
							made12 = true;
							found = true;
							this.ssrcMap.set(sender, thing.ssrc);
							this.makeOp12(sender);
						}
					});
					//TODO Firefox made me do this, if I can figure out how to not do this, that'd be great
					if (!found && pc.localDescription?.sdp) {
						const sdp = Voice.parsesdp(pc.localDescription.sdp);

						const index = pc.getTransceivers().findIndex((_) => _.sender === sender);
						const temp = sdp.medias[index].atr.get("ssrc");
						if (temp) {
							const ssrc = +[...temp][0].split(" ")[0];
							this.ssrcMap.set(sender, ssrc);
							this.makeOp12(sender);
							console.warn("ssrc");
							made12 = true;
						}
					}
				}
				if (!made12) {
					console.warn("this was ran :3");
					this.makeOp12();
				}
			};
			const RTC_CONNECT_TIMEOUT_MS = 15000;
			let rtcConnectTimeoutId: ReturnType<typeof setTimeout> | null = null;
			const clearRtcConnectTimeout = () => {
				if (rtcConnectTimeoutId != null) {
					clearTimeout(rtcConnectTimeoutId);
					rtcConnectTimeoutId = null;
				}
			};
			const detectDone = () => {
				if (
					pc.signalingState === "stable" &&
					pc.iceConnectionState === "connected" &&
					pc.connectionState === "connected"
				) {
					clearRtcConnectTimeout();
					this.status = "done";
					this.onconnect();
				}
				console.log(pc.signalingState, pc.iceConnectionState, pc.connectionState);
			};
			function logState(thing: string, message = "") {
				console.log("log state: " + thing + (message ? ":" + message : ""));
			}
			pc.addEventListener("negotiationneeded", async () => {
				logState("negotiationneeded");
				// Stream viewers: never send a second offer. We create one offer in startWebRTC,
				// get the answer, set it — done. A second offer overwrites localDescription and
				// breaks RTP demux (server sends bytes but viewer reports 0 bytes received).
				if (this.settings.isStreamViewer) {
					console.log("[voice] Stream viewer: ignoring negotiationneeded (one-shot negotiation)");
					return;
				}
				await sendOffer(true);
				console.log(this.ssrcMap);
			});
			pc.onicecandidate = (e) => {
				console.warn(e.candidate);
			};

			pc.addEventListener("signalingstatechange", async () => {
				logState("signalingstatechange", pc.signalingState);
				detectDone();
				while (!this.counter) await new Promise((res) => setTimeout(res, 100));
				if (this.pc && this.counter) {
					if (pc.signalingState === "have-local-offer") {
						const val = (Math.random() * 1000) ^ 0;
						logState("update", "start sent remote " + val);
						await this.updateRemote();
						logState("update", "end sent remote " + val);
					}
				} else {
					console.warn("uh oh!");
				}
			});
			pc.addEventListener("connectionstatechange", async () => {
				logState("connectionstatechange", pc.connectionState);
				detectDone();
				if (pc.connectionState === "connecting") {
					//logState("update2", "start Set local desc");
					//await pc.setLocalDescription();
					//logState("update2", "Set local desc");
				}
			});
			pc.addEventListener("icegatheringstatechange", async () => {
				logState("icegatheringstatechange", pc.iceGatheringState);
				detectDone();
				console.log(this.counter, this.pc);
				if (pc.iceGatheringState === "complete") {
					if (setting) return;
					// Stream viewer: never replace local description (we have one from startWebRTC)
					if (this.settings.isStreamViewer) return;
					// Don't call setLocal when we're in have-local-offer state (waiting for remote answer)
					// This prevents race with updateRemote() which does setRemoteDescription
					if (pc.signalingState === "have-local-offer") return;
					if (this.pc && this.counter) {
						setLocal();
					}
				}
			});
			pc.addEventListener("iceconnectionstatechange", async () => {
				logState("iceconnectionstatechange", pc.iceConnectionState);

				detectDone();
				if (pc.iceConnectionState === "checking") {
					// Stream viewer: never send a new offer (we already have one from startWebRTC).
					// Replacing it here breaks the answer we'll get — viewer then gets 0 bytes.
					if (this.settings.isStreamViewer) return;
					// Don't send offer when we're in have-local-offer state (waiting for remote answer)
					if (pc.signalingState === "have-local-offer") return;
					await sendOffer();
				}
			});

			// If RTC never reaches "connected", leave so user can disconnect and retry (avoids indefinite hang)
			if (!this.settings.isStreamViewer) {
				rtcConnectTimeoutId = setTimeout(() => {
					rtcConnectTimeoutId = null;
					if (this.status !== "done" && this.pc?.connectionState !== "connected") {
						console.warn("[voice] RTC connect timeout (" + RTC_CONNECT_TIMEOUT_MS + "ms), leaving so you can retry");
						this._wsConnecting = false;
						this.leave();
					}
				}, RTC_CONNECT_TIMEOUT_MS);
			}
		}
	}
	async getCamInfo() {
		let video_ssrc = 0;
		let rtx_ssrc = 0;
		const cammera = this.cammera;
		const cam = this.cam;
		let attemps = 0;
		// #region agent log
		DEBUG_INGEST_URL&&fetch(DEBUG_INGEST_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voice.ts:getCamInfo-entry',message:'getCamInfo starting',data:{hasCam:!!cam,hasCammera:!!cammera,camDirection:cam?.direction,senderTrack:cam?.sender?.track?.id,senderTrackKind:cam?.sender?.track?.kind},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H39'})}).catch(()=>{});
		// #endregion
		if (cam && cammera) {
			do {
				if (attemps > 10) {
					// #region agent log
					DEBUG_INGEST_URL&&fetch(DEBUG_INGEST_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voice.ts:getCamInfo-timeout',message:'getCamInfo timed out after 10 attempts',data:{video_ssrc,rtx_ssrc,attemps},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H39'})}).catch(()=>{});
					// #endregion
					
					// Fallback: parse SSRC from SDP if stats failed
					if ((!video_ssrc || !rtx_ssrc) && this.pc?.localDescription?.sdp) {
						try {
							console.log("[voice] getCamInfo: parsing SSRC from SDP fallback");
							const sdp = Voice.parsesdp(this.pc.localDescription.sdp);
							const index = this.pc.getTransceivers().findIndex((_) => _.sender === cam.sender);
							if (index >= 0 && sdp.medias[index]) {
								const temp = sdp.medias[index].atr.get("ssrc");
								if (temp) {
									// Extract all SSRCs from the set
									const ssrcs = [...temp].map(line => +line.split(" ")[0]);
									// First SSRC is usually main video
									if (!video_ssrc && ssrcs.length > 0) video_ssrc = ssrcs[0];
									// If there's a second SSRC (e.g. from fid group), it's likely RTX?
									// Or we need to parse ssrc-group?
									// For now, if we found video_ssrc, that's the most important part to unblock Op12.
									
									// Try to find RTX via ssrc-group FID if possible, but basic video_ssrc is critical.
									const groups = sdp.medias[index].atr.get("ssrc-group");
									if (groups) {
										for (const group of groups) {
											if (group.startsWith("FID")) {
												const parts = group.split(" ");
												if (+parts[1] === video_ssrc) {
													rtx_ssrc = +parts[2];
												}
											}
										}
									}
								}
							}
						} catch (e) {
							console.warn("[voice] getCamInfo SDP fallback failed:", e);
						}
					}

					return {video_ssrc, rtx_ssrc};
				}
				const stats = (await cam.sender.getStats()) as Map<string, any>;
				const statsArray = Array.from(stats);
				// #region agent log
				if (attemps === 0 || attemps === 5 || attemps === 10) {
					DEBUG_INGEST_URL&&fetch(DEBUG_INGEST_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voice.ts:getCamInfo-attempt',message:'getCamInfo attempt',data:{attemps,statsCount:statsArray.length,statsTypes:statsArray.map(s=>s[1].type),video_ssrc,rtx_ssrc,firstStat:statsArray[0]?.[1]},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H39'})}).catch(()=>{});
				}
				// #endregion
				Array.from(stats).forEach((_) => {
					if (_[1].ssrc) {
						video_ssrc = _[1].ssrc;
					}
					if (_[1].rtxSsrc) {
						rtx_ssrc = _[1].rtxSsrc;
					}
				});
				attemps++;
				await new Promise((res) => setTimeout(res, 100));
			} while (!video_ssrc || !rtx_ssrc);
			// #region agent log
			DEBUG_INGEST_URL&&fetch(DEBUG_INGEST_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voice.ts:getCamInfo-success',message:'getCamInfo found SSRCs',data:{video_ssrc,rtx_ssrc,attemps},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H39'})}).catch(()=>{});
			// #endregion
		} else {
			// #region agent log
			DEBUG_INGEST_URL&&fetch(DEBUG_INGEST_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voice.ts:getCamInfo-noCamOrCammera',message:'getCamInfo skipped - no cam or cammera',data:{hasCam:!!cam,hasCammera:!!cammera,video_ssrc,rtx_ssrc},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H1'})}).catch(()=>{});
			// #endregion
		}
		return {video_ssrc, rtx_ssrc};
	}

	/**
	 * Apply resolution/bitrate to the encoder (RTCRtpSender).
	 * - Resolution: scaleResolutionDownBy so encoder outputs at selected resolution; display size is fixed by CSS (object-fit: contain).
	 * - Bitrate: maxBitrate as encoder target; maxFramerate keeps 30fps so encoder reduces quality (not frame rate) when bitrate is low.
	 */
	async applyStreamEncodingParams(): Promise<boolean> {
		// Apply when we have an active video sender (stream or live); don't rely only on settings.stream
		const sender = this.cam?.sender;
		if (!sender?.track || sender.track.kind !== "video") {
			console.warn("[Voice] applyStreamEncodingParams: no video sender (cam?", !!this.cam, "track?", sender?.track?.kind, ")");
			return false;
		}
		const height = this.settings.resolution?.height ?? 720;
		const bitrate = this.settings.bitrate ?? 2500000;
		try {
			const params = sender.getParameters();
			if (!params.encodings || params.encodings.length === 0) {
				params.encodings = [{}];
			}
			const enc = params.encodings[0];
			if (!enc) return false;
			enc.maxBitrate = bitrate;
			enc.maxFramerate = 30;
			const trackSettings = sender.track.getSettings();
			const trackHeight = typeof trackSettings.height === "number" ? trackSettings.height : height;
			if (trackHeight > 0) {
				let scale = trackHeight / height;
				if (scale < 1) scale = 1;
				// When bitrate is very low, scale down so encoder keeps 30fps (smooth but terrible quality) instead of dropping frames (lag).
				const maxHeightForBitrate =
					bitrate <= 100000 ? 144 : bitrate <= 200000 ? 240 : bitrate <= 350000 ? 360 : bitrate <= 600000 ? 480 : bitrate <= 1200000 ? 720 : 9999;
				const scaleForBitrate = maxHeightForBitrate < 9999 ? trackHeight / maxHeightForBitrate : 1;
				if (scaleForBitrate > scale) scale = scaleForBitrate;
				// Round up scale so we never under-scale (avoids encoder struggling and dropping frames).
				scale = Math.ceil(scale * 10) / 10;
				enc.scaleResolutionDownBy = scale;
			} else {
				enc.scaleResolutionDownBy = 1;
			}
			await sender.setParameters(params);
			const effectiveH = trackHeight > 0 && enc.scaleResolutionDownBy ? Math.round(trackHeight / enc.scaleResolutionDownBy) : null;
			console.log("[Voice] Stream encoding updated: bitrate=" + (enc.maxBitrate ?? "?") + ", scaleResolutionDownBy=" + (enc.scaleResolutionDownBy ?? "?") + (effectiveH != null ? ", effectiveHeight=" + effectiveH : ""));
			return true;
		} catch (e) {
			console.warn("[Voice] Failed to apply stream encoding params:", e);
			return false;
		}
	}

	async makeOp12(
		sender: RTCRtpSender | undefined | [RTCRtpSender, number] = this.ssrcMap.entries().next().value,
	) {
		if (!this.ws) return;
		if (sender instanceof Array) {
			sender = sender[0];
		}

		let max_framerate = 20;
		let width = this.settings.resolution?.width || 1280;
		let height = this.settings.resolution?.height || 720;
		const bitrate = this.settings.bitrate || 2500000;

		// Apply resolution/bitrate on the fly so stream updates without restart
		await this.applyStreamEncodingParams();

		const {rtx_ssrc, video_ssrc} = await this.getCamInfo();
		// #region agent log - enhanced with SDP inspection
		const localSdpForLog = this.pc?.localDescription?.sdp || '';
		const sdpSsrcLines = localSdpForLog.match(/a=ssrc:(\d+)/g) || [];
		const sdpSsrcGroupLines = localSdpForLog.match(/a=ssrc-group:FID (\d+) (\d+)/g) || [];
		const senderTracks = this.cam?.sender?.track ? { 
			id: this.cam.sender.track.id, 
			enabled: this.cam.sender.track.enabled, 
			readyState: this.cam.sender.track.readyState,
			muted: this.cam.sender.track.muted
		} : null;
		DEBUG_INGEST_URL&&fetch(DEBUG_INGEST_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voice.ts:makeOp12-fullState',message:'Streamer makeOp12 full state',data:{isStream:this.settings.stream,video_ssrc,rtx_ssrc,hasCam:!!this.cam,hasCammera:!!this.cammera,camDirection:this.cam?.direction,sdpSsrcLines:sdpSsrcLines.slice(0,10),sdpSsrcGroupLines:sdpSsrcGroupLines.slice(0,5),senderTracks,pcConnectionState:this.pc?.connectionState,pcSignalingState:this.pc?.signalingState,iceConnectionState:this.pc?.iceConnectionState,localSdpLen:localSdpForLog.length},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H1'})}).catch(()=>{});
		// #endregion
		if (this.cam && this.cammera) {
		} else if (!sender) {
			return;
		}

		try {
			this.ws.send(
				JSON.stringify({
					op: 12,
					d: {
						audio_ssrc:
							sender?.track?.kind === "audio" ? this.ssrcMap.get(sender as RTCRtpSender) : 0,
						video_ssrc,
						rtx_ssrc,
						streams: [
							{
								type: "video",
								rid: "100",
								ssrc: video_ssrc,
								active: !!video_ssrc,
								quality: 100,
								rtx_ssrc: rtx_ssrc,
								max_bitrate: bitrate,
								max_framerate, //TODO
								max_resolution: {type: "fixed", width, height},
							},
						],
					},
				}),
			);
			// Only show "sendingStreams" when we're the streamer sending video; viewers never show this
			if (this.settings.stream && (this.cam || this.settings.live)) {
				this.status = "sendingStreams";
			}
		} catch (e) {
			console.error("Failed to send op12:", e);
		}
	}
	senders: Set<RTCRtpSender> = new Set();
	recivers = new Set<RTCRtpReceiver>();
	ssrcMap: Map<RTCRtpSender, number> = new Map();
	speaking = false;
	async setupMic(audioStream: MediaStream) {
		const audioContext = new AudioContext();
		const analyser = audioContext.createAnalyser();
		const microphone = audioContext.createMediaStreamSource(audioStream);

		analyser.smoothingTimeConstant = 0;
		analyser.fftSize = 32;

		microphone.connect(analyser);
		const array = new Float32Array(1);
		const interval = setInterval(() => {
			if (!this.ws) {
				clearInterval(interval);
			}
			analyser.getFloatFrequencyData(array);
			const value = array[0] + 65;
			if (value < 0) {
				if (this.speaking) {
					this.speaking = false;
					this.sendSpeaking();
					console.log("not speaking");
				}
			} else if (!this.speaking) {
				console.log("speaking");
				this.speaking = true;
				this.sendSpeaking();
			}
		}, 500);
	}
	async sendSpeaking() {
		if (!this.ws) return;
		const pair = this.ssrcMap.entries().next().value;
		if (!pair) return;
		this.onSpeakingChange(this.userid, +this.speaking);
		this.ws.send(
			JSON.stringify({
				op: 5,
				d: {
					speaking: this.speaking,
					delay: 5, //not sure
					ssrc: pair[1],
				},
			}),
		);
	}
	async continueWebRTC(data: sdpback) {
		if (this.pc && this.offer) {
			this.counter = data.d.sdp;
			// When we re-sent the offer (e.g. after "offer changed since start"), server sends a new answer (op 4).
			// Apply it here so we don't rely only on signalingstatechange (which doesn't fire again).
			if (this.pc.signalingState === "have-local-offer") {
				this.updateRemote().catch((err) => console.warn("[voice] updateRemote after continueWebRTC:", err));
			}
		} else {
			this.status = "conectionFailed";
		}
	}
	/** Send current local offer (op1) to server so it can answer it. Used when we skipped setRemoteDescription due to "offer changed since start". */
	sendCurrentOfferToServer() {
		const sdp = this.pc?.localDescription?.sdp;
		if (!sdp || !this.ws) return;
		const parsed = Voice.parsesdp(sdp);
		const video = new Map<string, [number, number]>();
		const audio = new Map<string, number>();
		let cur: [number, number] | undefined;
		for (const thing of parsed.medias) {
			try {
				if (thing.media === "video") {
					const rtpmap = thing.atr.get("rtpmap");
					if (!rtpmap) continue;
					for (const codecpair of rtpmap) {
						const [port, codec] = codecpair.split(" ");
						if (cur && codec.split("/")[0] === "rtx") {
							cur[1] = Number(port);
							cur = undefined;
							continue;
						}
						if (video.has(codec.split("/")[0])) continue;
						cur = [Number(port), -1];
						video.set(codec.split("/")[0], cur);
					}
				} else if (thing.media === "audio") {
					const rtpmap = thing.atr.get("rtpmap");
					if (!rtpmap) continue;
					for (const codecpair of rtpmap) {
						const [port, codec] = codecpair.split(" ");
						if (audio.has(codec.split("/")[0])) continue;
						audio.set(codec.split("/")[0], Number(port));
					}
				}
			} finally {
				// no-op
			}
		}
		const codecs: { name: string; type: "video" | "audio"; priority: number; payload_type: number; rtx_payload_type: number | null }[] = [];
		const audioAlloweds = new Map([["opus", { priority: 1000 }]]);
		for (const thing of audio) {
			if (audioAlloweds.has(thing[0])) {
				codecs.push({
					name: thing[0],
					type: "audio",
					priority: audioAlloweds.get(thing[0])!.priority,
					payload_type: thing[1],
					rtx_payload_type: null,
				});
			}
		}
		const videoAlloweds = new Map([
			["H264", { priority: 1000 }],
			["VP8", { priority: 2000 }],
			["VP9", { priority: 3000 }],
		]);
		for (const thing of video) {
			if (videoAlloweds.has(thing[0])) {
				codecs.push({
					name: thing[0],
					type: "video",
					priority: videoAlloweds.get(thing[0])!.priority,
					payload_type: thing[1][0],
					rtx_payload_type: thing[1][1],
				});
			}
		}
		this.ws.send(
			JSON.stringify({
				d: { codecs, protocol: "webrtc", data: sdp, sdp },
				op: 1,
			}),
		);
		console.log("[voice] sendCurrentOfferToServer: sent op1 with current offer so server can answer it");
	}
	reciverMap = new Map<number, RTCRtpReceiver>();
	off?: Promise<RTCSessionDescriptionInit>;
	async makeOffer() {
		if (this.off) {
			if (this.pc?.localDescription?.sdp) return {sdp: this.pc?.localDescription?.sdp};
			return this.off;
		}
		return (this.off = new Promise<RTCSessionDescriptionInit>(async (res) => {
			if (!this.pc) throw new Error("stupid");
			console.error("stupid!");
			const offer = await this.pc.createOffer({
				offerToReceiveAudio: true,
				offerToReceiveVideo: true,
			});
			res(offer);
		}));
	}
	async figureRecivers() {
		await new Promise((res) => setTimeout(res, 500));
		for (const reciver of this.recivers) {
			const stats = (await reciver.getStats()) as Map<string, any>;
			for (const thing of stats) {
				if (thing[1].ssrc) {
					this.reciverMap.set(thing[1].ssrc, reciver);
				}
			}
		}
		console.log(this.reciverMap);
	}
	updateMute() {
		if (!this.micTrack) return;
		this.micTrack.enabled = !this.owner.mute;
	}
	mic?: RTCRtpSender;
	micTrack?: MediaStreamTrack;
	onVideo = (_video: HTMLVideoElement, _id: string) => {};
	videos = new Map<string, HTMLVideoElement>();
	cam?: RTCRtpTransceiver;
	cammera?: MediaStreamTrack;
	async stopVideo() {
		if (!this.cam) return;
		this.owner.video = false;
		if (!this.cammera || !this.pc) return;
		this.cammera.stop();
		this.cammera = undefined;

		this.cam.sender.replaceTrack(null);
		this.cam.direction = "inactive";

		this.pc.setLocalDescription(await this.pc.createOffer());

		this.owner.updateSelf();

		this.videos.delete(this.userid);
		this.onUserChange(this.userid, {
			deaf: false,
			muted: this.owner.mute,
			video: false,
			live: this.owner.stream,
		});
	}
	liveMap = new Map<string, HTMLVideoElement>();
	voiceMap = new Map<string, Voice>();
	isLive() {
		return !!this.voiceMap.get(this.userid);
	}
	getLive(id: string) {
		return this.liveMap.get(id);
	}
	joinLive(id: string) {
		return this.owner.joinLive(id);
	}
	createLive(stream: MediaStream) {
		return this.owner.createLive(stream);
	}
	leaveLive(id: string) {
		const v = this.voiceMap.get(id);
		if (!v) return;
		v.leave();
		this.voiceMap.delete(id);
		this.liveMap.delete(id);
		this.onLeaveStream(id);
	}
	stopStream() {
		this.leaveLive(this.userid);
		this.owner.leaveLive();
	}
	onLeaveStream = (_user: string) => {};
	onGotStream = (_v: HTMLVideoElement, _user: string) => {};
	gotStream(voice: Voice, user: string) {
		voice.onVideo = (video) => {
			this.liveMap.set(user, video);
			this.onGotStream(video, user);
		};
		this.voiceMap.set(user, voice);
	}
	videoStarted = false;
	streamAudioSender?: RTCRtpSender;

	async startVideo(caml: MediaStream) {
		// #region agent log
		DEBUG_INGEST_URL&&fetch(DEBUG_INGEST_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voice.ts:startVideo-entry',message:'startVideo function ENTERED',data:{hasCaml:!!caml,camlTracks:caml?.getTracks().length,hasCam:!!this.cam,settingsStream:this.settings.stream},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H42'})}).catch(()=>{});
		// #endregion
		while (!this.cam) {
			await new Promise((res) => setTimeout(res, 100));
		}
		console.warn("test test test test video sent!");
		const videoTracks = caml.getVideoTracks();
		const audioTracks = caml.getAudioTracks();
		const [cam] = videoTracks;

		console.log("Stream has", videoTracks.length, "video tracks and", audioTracks.length, "audio tracks");
		// #region agent log
		DEBUG_INGEST_URL&&fetch(DEBUG_INGEST_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voice.ts:startVideo',message:'Streamer starting video',data:{isStream:this.settings.stream,videoTracksCount:videoTracks.length,audioTracksCount:audioTracks.length,camEnabled:cam?.enabled,camMuted:cam?.muted,camReadyState:cam?.readyState},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H5'})}).catch(()=>{});
		// #endregion

		if (!this.settings.stream) this.owner.video = true;

		this.cammera = cam;

		const video = document.createElement("video");
		forceVideo(video);
		this.liveMap.set(this.userid, video);
		this.onVideo(video, this.userid);
		this.videos.set(this.userid, video);
		video.srcObject = caml;
		video.autoplay = true;
		this.cam.direction = "sendonly";
		const sender = this.cam.sender;
		this.senders.add(sender);

		await sender.replaceTrack(cam);
		sender.setStreams(caml);

		// Also send audio tracks if present (for screen share with system audio)
		if (audioTracks.length > 0 && this.pc) {
			const [audioTrack] = audioTracks;
			console.log("Adding stream audio track:", audioTrack.label);
			
			// Find an inactive audio transceiver to use, or add a new one
			const transceivers = this.pc.getTransceivers();
			let audioTransceiver = transceivers.find(t => 
				t.sender.track === null && 
				t.receiver.track?.kind === 'audio' &&
				t.direction === 'inactive'
			);
			
			if (audioTransceiver) {
				console.log("Using existing audio transceiver for stream audio");
				audioTransceiver.direction = "sendonly";
				await audioTransceiver.sender.replaceTrack(audioTrack);
				this.streamAudioSender = audioTransceiver.sender;
				this.senders.add(audioTransceiver.sender);
			} else {
				console.log("Adding new audio track to PC");
				this.streamAudioSender = this.pc.addTrack(audioTrack, caml);
				this.senders.add(this.streamAudioSender);
			}
		}

		this.forceNext = true;

		console.warn("replaced track", cam);
		// For streams: do NOT create a second offer here. A second offer creates a second transport
		// on the server; the producer is created on the first transport but the client sends RTP to
		// the second (after setRemoteDescription(answer2)), so the producer never receives RTP.
		// Use the single offer/answer from startWebRTC; just replaceTrack and send op12 with SSRC from stats.
		if (!this.settings.stream) {
			this.pc?.setLocalDescription((await this.pc?.createOffer()) || {});
		}
		
		// For streams: wait briefly for sender stats to have the new SSRC, then send op12 (no renegotiation).
		if (this.settings.stream && this.pc) {
			console.log("[Stream] Waiting for sender stats to have SSRC, then sending op12 (single transport)");
			let attempts = 0;
			while (attempts < 30) {
				await new Promise((res) => setTimeout(res, 100));
				attempts++;
				const { video_ssrc } = await this.getCamInfo();
				if (video_ssrc) {
					console.log("[Stream] Got video SSRC from stats, sending op12");
					this.makeOp12();
					break;
				}
			}
			if (attempts >= 30) {
				console.warn("[Stream] Could not get video SSRC from stats after 3s, sending op12 anyway");
				this.makeOp12();
			}
		} else if (this.settings.stream) {
			this.makeOp12();
		} else {
			this.owner.updateSelf();
		}
	}
	onconnect = () => {};
	streams = new Set<MediaStreamTrack>();
	async startWebRTC() {
		this.status = "makingOffer";
		const pc = new RTCPeerConnection({
			bundlePolicy: "max-bundle",
		});
		pc.ontrack = async (e) => {
			// #region agent log
			DEBUG_INGEST_URL&&fetch(DEBUG_INGEST_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voice.ts:ontrack',message:'ontrack event fired',data:{trackKind:e.track.kind,trackId:e.track.id,trackEnabled:e.track.enabled,trackMuted:e.track.muted,trackReadyState:e.track.readyState,streamId:e.streams[0]?.id,streamActive:e.streams[0]?.active,isStream:this.settings.stream,iceConnectionState:pc.iceConnectionState,connectionState:pc.connectionState,signalingState:pc.signalingState},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H21'})}).catch(()=>{});
			// #endregion
			this.status = "done";
			this.onconnect();
			const media = e.streams[0];
			if (!media) {
				console.log(e);
				// #region agent log
				DEBUG_INGEST_URL&&fetch(DEBUG_INGEST_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voice.ts:ontrack-nomedia',message:'ontrack: no media stream',data:{trackKind:e.track.kind,trackId:e.track.id},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H4'})}).catch(()=>{});
				// #endregion
				return;
			}
			let userId = media.id.split("-")[0];
			if (e.track.kind === "video") {
				//TODO I don't know why but without this firefox bugs out on streams
				if (media.id.match("{")) return;
				if (this.owner.currentVoice?.voiceMap.get(this.userid) === this) {
					// #region agent log
					DEBUG_INGEST_URL&&fetch(DEBUG_INGEST_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voice.ts:ontrack-skip-self',message:'ontrack: skipping own stream',data:{userId,isStream:this.settings.stream},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H4'})}).catch(()=>{});
					// #endregion
					return;
				}

				// Valid Discord user IDs (snowflakes) are 17-19 digit numbers.
				// Browser/Mediasoup use non-snowflake stream ids (e.g. "e12b5e7e-..." UUIDs); never skip video for that.
				const isValidSnowflake = /^\d{17,19}$/.test(String(userId));
				if (!isValidSnowflake) {
					// Always accept non-snowflake video (Mediasoup/stream); use producer id from op12 or placeholder.
					if (this.vidusers.size === 1) {
						userId = [...this.vidusers.values()][0];
						console.log("[Voice] Accepting video with non-snowflake stream id, using producer id:", userId);
					} else {
						userId = "__pending_stream_producer__";
						console.log("[Voice] Accepting video with non-snowflake stream id (vidusers.size=" + this.vidusers.size + ", isStreamViewer=" + this.settings.isStreamViewer + ", stream=" + this.settings.stream + "), using placeholder until op12");
					}
				}

				this.streams.add(e.track);
				const video = document.createElement("video");
				forceVideo(video);
				this.onVideo(video, userId);
				this.videos.set(userId, video);
				video.srcObject = media;
				video.playsInline = true; // Avoid fullscreen takeover; helps live stream playback on some platforms
				console.log(video);

				video.autoplay = true;

				// DEBUG: Why does a frame appear exactly when loadedmetadata / loadeddata / canplay fire?
				// - The HTML5 video pipeline (RTP → depacketize → decode → compositor) outputs the first
				//   decodable frame when it receives and decodes the first KEYFRAME. That moment triggers:
				//   loadedmetadata (dimensions known), loadeddata (first frame decoded), canplay (can play).
				//   So the frame appears at that instant because that's when the first keyframe is decoded.
				// Why is the video flow broken (only one frame or very slow)?
				// - After the first keyframe, the viewer needs P-frames (delta frames) to decode more frames.
				//   If the remote SDP applied to setRemoteDescription did NOT include the correct video SSRC
				//   (e.g. answer was applied before op12 so vidusers was empty and cleanServerSDP built no
				//   a=ssrc in the video m-line), the browser's receiver may not associate ongoing RTP with
				//   the correct SSRC, so only the first burst (first keyframe) gets through. Fix: ensure
				//   cleanServerSDP preserves the server's video SSRC from the raw answer when vidusers is empty.
				// - Alternatively, the producer may send keyframes very rarely; server-side periodic
				//   keyframe requests (VoiceRoom STREAM_KEYFRAME_INTERVAL_MS) help.
				// Add event listeners to track video loading state
				video.addEventListener('loadedmetadata', () => {
					// #region agent log
					DEBUG_INGEST_URL&&fetch(DEBUG_INGEST_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voice.ts:video-loadedmetadata',message:'Video loadedmetadata event fired',data:{userId,videoWidth:video.videoWidth,videoHeight:video.videoHeight,videoReadyState:video.readyState,isStream:this.settings.stream},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H10'})}).catch(()=>{});
					// #endregion
					console.log("[voice] Video loadedmetadata:", video.videoWidth, "x", video.videoHeight);
				});
				video.addEventListener('loadeddata', () => {
					// #region agent log
					DEBUG_INGEST_URL&&fetch(DEBUG_INGEST_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voice.ts:video-loadeddata',message:'Video loadeddata event fired',data:{userId,videoWidth:video.videoWidth,videoHeight:video.videoHeight,videoReadyState:video.readyState,isStream:this.settings.stream},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H10'})}).catch(()=>{});
					// #endregion
					console.log("[voice] Video loadeddata");
				});
				video.addEventListener('canplay', () => {
					// #region agent log
					DEBUG_INGEST_URL&&fetch(DEBUG_INGEST_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voice.ts:video-canplay',message:'Video canplay event fired',data:{userId,videoWidth:video.videoWidth,videoHeight:video.videoHeight,isStream:this.settings.stream},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H10'})}).catch(()=>{});
					// #endregion
					console.log("[voice] Video canplay");
					// Ensure playback continues (live stream can stall after first frame if play() was called before data arrived)
					video.play().catch(() => {});
				});

				// #region agent log
				DEBUG_INGEST_URL&&fetch(DEBUG_INGEST_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voice.ts:ontrack-video-attached',message:'Video track attached to element',data:{userId,mediaId:media.id,trackEnabled:e.track.enabled,trackMuted:e.track.muted,isStream:this.settings.stream,videoInDOM:!!video.parentElement,videoWidth:video.videoWidth,videoHeight:video.videoHeight},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H6'})}).catch(()=>{});
				// #endregion
				console.log("gotVideo?", media);
				// So viewers get self_video in gateway; streamer sets it in onSatusChange when startVideo runs.
				if (this.settings.isStreamViewer && this.owner) {
					this.owner.video = true;
					this.owner.updateSelf();
				}

				// Try to play video explicitly and check for autoplay issues
				video.play().then(() => {
					// #region agent log
					DEBUG_INGEST_URL&&fetch(DEBUG_INGEST_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voice.ts:ontrack-video-play-success',message:'video.play() succeeded',data:{userId,videoWidth:video.videoWidth,videoHeight:video.videoHeight,videoReadyState:video.readyState,videoPaused:video.paused,videoInDOM:!!video.parentElement},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H8'})}).catch(()=>{});
					// #endregion
				}).catch((err) => {
					// #region agent log
					DEBUG_INGEST_URL&&fetch(DEBUG_INGEST_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voice.ts:ontrack-video-play-error',message:'video.play() FAILED',data:{userId,error:String(err),videoInDOM:!!video.parentElement},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H8'})}).catch(()=>{});
					// #endregion
				});

				// Live stream: if video stalls after first frame (paused but has data), keep trying play()
				if (this.settings.isStreamViewer) {
					let lastCurrentTime = 0;
					const stallCheck = setInterval(() => {
						if (!video.srcObject || video.readyState < 2) return;
						if (video.paused) {
							video.play().catch(() => {});
						} else {
							// If currentTime is advancing, playback is fine; stop checking after 30s of steady play
							if (video.currentTime > lastCurrentTime) {
								lastCurrentTime = video.currentTime;
								if (video.currentTime > 5) {
									clearInterval(stallCheck);
								}
							}
						}
					}, 1000);
					setTimeout(() => clearInterval(stallCheck), 60000);
				}

				// Check video state after a delay to see if it's actually rendering
				setTimeout(async () => {
					// Avoid getStats() if connection closed (InvalidStateError)
					if (pc.connectionState === "closed" || pc.connectionState === "failed") return;
					// Get RTCRtpReceiver stats to check what's being received
					let receiverStats: any = null;
					let audioStats: any = null;
					try {
						const stats = await e.receiver.getStats();
						stats.forEach((report: any) => {
							if (report.type === 'inbound-rtp' && report.kind === 'video') {
								receiverStats = {
									bytesReceived: report.bytesReceived,
									packetsReceived: report.packetsReceived,
									packetsLost: report.packetsLost,
									framesDecoded: report.framesDecoded,
									framesDropped: report.framesDropped,
									framesReceived: report.framesReceived,
									keyFramesDecoded: report.keyFramesDecoded,
									totalDecodeTime: report.totalDecodeTime,
									jitter: report.jitter,
									pliCount: report.pliCount,
									firCount: report.firCount,
									nackCount: report.nackCount,
								};
							}
						});
						// Also get audio stats and ICE candidate pair from the peer connection
						const pcStats = await pc.getStats();
						let candidatePair: any = null;
						const allInboundRtp: any[] = [];
						pcStats.forEach((report: any) => {
							if (report.type === 'inbound-rtp') {
								allInboundRtp.push({kind:report.kind,ssrc:report.ssrc,bytesReceived:report.bytesReceived,packetsReceived:report.packetsReceived,packetsLost:report.packetsLost,trackIdentifier:report.trackIdentifier,mid:report.mid});
								if (report.kind === 'audio') {
									audioStats = {
										bytesReceived: report.bytesReceived,
										packetsReceived: report.packetsReceived,
										packetsLost: report.packetsLost,
										jitter: report.jitter,
									};
								}
							}
							// Get the active ICE candidate pair to verify transport
							if (report.type === 'candidate-pair' && report.state === 'succeeded') {
								candidatePair = {
									localCandidateId: report.localCandidateId,
									remoteCandidateId: report.remoteCandidateId,
									bytesSent: report.bytesSent,
									bytesReceived: report.bytesReceived,
									packetsSent: report.packetsSent,
									packetsReceived: report.packetsReceived,
									currentRoundTripTime: report.currentRoundTripTime,
									state: report.state,
								};
							}
						});
						// #region agent log
						DEBUG_INGEST_URL&&fetch(DEBUG_INGEST_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voice.ts:ontrack-allInboundRtp',message:'ALL inbound-rtp reports at 500ms',data:{userId,allInboundRtp,candidatePair,isStreamViewer:this.settings.isStreamViewer},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H53'})}).catch(()=>{});
						// #endregion
					} catch (err) {
						if (err instanceof Error && err.name !== "InvalidStateError") console.warn("[voice] getStats @500ms:", err);
					}
					// #region agent log
					DEBUG_INGEST_URL&&fetch(DEBUG_INGEST_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voice.ts:ontrack-video-state-500ms',message:'Video element state at 500ms',data:{userId,videoWidth:video.videoWidth,videoHeight:video.videoHeight,videoReadyState:video.readyState,videoPaused:video.paused,videoCurrentTime:video.currentTime,videoInDOM:!!video.parentElement,parentTagName:video.parentElement?.tagName,isStream:this.settings.stream,srcObjectId:(video.srcObject as MediaStream)?.id,srcObjectActive:(video.srcObject as MediaStream)?.active,srcObjectTrackCount:(video.srcObject as MediaStream)?.getTracks().length,videoTrackEnabled:(video.srcObject as MediaStream)?.getVideoTracks()[0]?.enabled,videoTrackMuted:(video.srcObject as MediaStream)?.getVideoTracks()[0]?.muted,videoTrackReadyState:(video.srcObject as MediaStream)?.getVideoTracks()[0]?.readyState,videoReceiverStats:receiverStats,audioReceiverStats:audioStats,iceConnectionState:pc.iceConnectionState,connectionState:pc.connectionState},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H33'})}).catch(()=>{});
					// #endregion
					console.log("[voice] VIDEO RECEIVER STATS @500ms (userId=" + userId + ", isStreamViewer=" + this.settings.isStreamViewer + "):", receiverStats ?? "no inbound-rtp video report");
				}, 500);

				// Extended check at 2 seconds - just log, don't re-attach srcObject
				// Re-attaching srcObject causes AbortError with video.play()
				setTimeout(async () => {
					if (pc.connectionState === "closed" || pc.connectionState === "failed") return;
					// Get RTCRtpReceiver stats
					let receiverStats: any = null;
					try {
						const stats = await e.receiver.getStats();
						stats.forEach((report: any) => {
							if (report.type === 'inbound-rtp' && report.kind === 'video') {
								receiverStats = {
									bytesReceived: report.bytesReceived,
									packetsReceived: report.packetsReceived,
									packetsLost: report.packetsLost,
									framesDecoded: report.framesDecoded,
									framesDropped: report.framesDropped,
									framesReceived: report.framesReceived,
									keyFramesDecoded: report.keyFramesDecoded,
									totalDecodeTime: report.totalDecodeTime,
									pliCount: report.pliCount,
									firCount: report.firCount,
								};
							}
						});
					} catch (err) {
						if (err instanceof Error && err.name !== "InvalidStateError") console.warn("[voice] getStats @2s:", err);
					}
					// #region agent log
					DEBUG_INGEST_URL&&fetch(DEBUG_INGEST_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voice.ts:ontrack-video-state-2000ms',message:'Video element state at 2000ms',data:{userId,videoWidth:video.videoWidth,videoHeight:video.videoHeight,videoReadyState:video.readyState,videoPaused:video.paused,videoCurrentTime:video.currentTime,srcObjectActive:(video.srcObject as MediaStream)?.active,videoTrackMuted:(video.srcObject as MediaStream)?.getVideoTracks()[0]?.muted,receiverStats},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H20'})}).catch(()=>{});
					// #endregion
					// Debug: log video receiver stats so we can see if RTP is reaching this receiver
					console.log("[voice] VIDEO RECEIVER STATS @2s (userId=" + userId + ", isStreamViewer=" + this.settings.isStreamViewer + "):", receiverStats ?? "no inbound-rtp video report");
					if (video.readyState === 0) {
						console.log("[voice] Video still has no data after 2s - keyframe requests should handle this");
					}
				}, 2000);

				// Final check at 3 seconds
				setTimeout(() => {
					// #region agent log
					DEBUG_INGEST_URL&&fetch(DEBUG_INGEST_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voice.ts:ontrack-video-state-3000ms',message:'Video element state at 3000ms',data:{userId,videoWidth:video.videoWidth,videoHeight:video.videoHeight,videoReadyState:video.readyState,videoPaused:video.paused,videoCurrentTime:video.currentTime},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H14'})}).catch(()=>{});
					// #endregion
				}, 3000);

				// For stream viewers: signal to server that we're ready to receive video
				// This triggers a keyframe request so we can decode the video stream
				if (this.settings.isStreamViewer && this.ws) {
					const sendViewerReady = (attempt: number) => {
						if (!this.ws) return;

						// If we still have a placeholder ID (because ontrack fired before op12),
						// try to resolve the actual producer ID from vidusers now.
						if (userId === "__pending_stream_producer__") {
							console.log("[voice] Resolving pending producer id. vidusers:", [...this.vidusers.entries()]);
							const foundUser = [...this.vidusers.values()].find(u => u !== this.userid);
							if (foundUser) {
								console.log("[voice] Resolved pending producer id to:", foundUser);
								userId = foundUser;
							} else {
								// Don't send VIEWER_READY with placeholder; server can't match it. Retry when op12 arrives.
								console.warn("[voice] Skipping VIEWER_READY: producer id still __pending_stream_producer__ (op12 not received yet)");
								return;
							}
						}

						// #region agent log
						DEBUG_INGEST_URL&&fetch(DEBUG_INGEST_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voice.ts:ontrack-sendViewerReady',message:'Stream viewer sending VIEWER_READY (op 10)',data:{viewer:this.userid,producer:userId,attempt,trackMuted:e.track.muted,trackEnabled:e.track.enabled,trackReadyState:e.track.readyState,videoReadyState:video.readyState},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H14'})}).catch(()=>{});
						// #endregion
						console.log("[voice] Stream viewer sending VIEWER_READY for producer:", userId, "attempt:", attempt, "videoReadyState:", video.readyState);
						try {
							this.ws.send(JSON.stringify({
								op: 10, // VIEWER_READY
								d: {
									user_id: userId, // The producer we want keyframe from
								},
							}));
						} catch (err) {
							console.error("[voice] Failed to send VIEWER_READY:", err);
							// #region agent log
							DEBUG_INGEST_URL&&fetch(DEBUG_INGEST_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voice.ts:ontrack-sendViewerReady-error',message:'Failed to send VIEWER_READY',data:{viewer:this.userid,producer:userId,error:String(err)},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H14'})}).catch(()=>{});
							// #endregion
						}
					};

					// Wait for track to unmute (RTP flowing) before sending VIEWER_READY
					// ontrack fires during setRemoteDescription, but transport isn't fully ready yet
					// trackMuted goes false when RTP packets start arriving (~100-200ms after ontrack)
					const waitForTrackUnmute = () => {
						return new Promise<void>((resolve) => {
							if (!e.track.muted) {
								resolve();
								return;
							}
							const onUnmute = () => {
								e.track.removeEventListener('unmute', onUnmute);
								resolve();
							};
							e.track.addEventListener('unmute', onUnmute);
							// Fallback timeout in case unmute event doesn't fire
							setTimeout(() => {
								e.track.removeEventListener('unmute', onUnmute);
								resolve();
							}, 300);
						});
					};

					// Wait for transport to be ready (track unmutes), then request keyframe
					waitForTrackUnmute().then(() => {
						// #region agent log
						DEBUG_INGEST_URL&&fetch(DEBUG_INGEST_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voice.ts:ontrack-afterUnmute',message:'Track unmuted or timeout, sending VIEWER_READY',data:{viewer:this.userid,producer:userId,trackMuted:e.track.muted,videoReadyState:video.readyState},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H14'})}).catch(()=>{});
						// #endregion
						console.log("[voice] Track unmuted or timeout reached, sending VIEWER_READY");
						sendViewerReady(1);
					});

					// Always send additional keyframe requests with delays
					// Even if video is playing, these are harmless and ensure decoder sync
					setTimeout(() => {
						// #region agent log
						DEBUG_INGEST_URL&&fetch(DEBUG_INGEST_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voice.ts:ontrack-check300ms',message:'Requesting keyframe at 300ms',data:{viewer:this.userid,producer:userId,trackMuted:e.track.muted,videoReadyState:video.readyState},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H14'})}).catch(()=>{});
						// #endregion
						// Only request if video still not playing
						if (video.readyState === 0) {
							console.log("[voice] Video still not ready at 300ms, requesting keyframe again");
							sendViewerReady(2);
						}
					}, 300);

					setTimeout(() => {
						// #region agent log
						DEBUG_INGEST_URL&&fetch(DEBUG_INGEST_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voice.ts:ontrack-check600ms',message:'Requesting keyframe at 600ms',data:{viewer:this.userid,producer:userId,trackMuted:e.track.muted,videoReadyState:video.readyState},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H14'})}).catch(()=>{});
						// #endregion
						if (video.readyState === 0) {
							console.log("[voice] Video still not ready at 600ms, requesting keyframe again");
							sendViewerReady(3);
						}
					}, 600);

					// Check at 1000ms and request keyframe if still not ready
					setTimeout(() => {
						// #region agent log
						DEBUG_INGEST_URL&&fetch(DEBUG_INGEST_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voice.ts:ontrack-check1000ms',message:'Check at 1000ms',data:{viewer:this.userid,producer:userId,trackMuted:e.track.muted,trackEnabled:e.track.enabled,videoReadyState:video.readyState},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H14'})}).catch(()=>{});
						// #endregion
						if (video.readyState === 0) {
							console.log("[voice] Video still not ready at 1000ms, requesting keyframe again");
							sendViewerReady(4);
						}
					}, 1000);

					// Last resort at 1500ms
					setTimeout(() => {
						// #region agent log
						DEBUG_INGEST_URL&&fetch(DEBUG_INGEST_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voice.ts:ontrack-check1500ms',message:'Check at 1500ms',data:{viewer:this.userid,producer:userId,trackMuted:e.track.muted,videoReadyState:video.readyState},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H14'})}).catch(()=>{});
						// #endregion
						if (video.readyState === 0) {
							console.log("[voice] Video still not ready at 1500ms, requesting keyframe again");
							sendViewerReady(5);
						}
					}, 1500);
				}

				return;
			}

			console.log("got audio:", e);
			for (const track of media.getTracks()) {
				console.log(track);
			}

			const context = new AudioContext();
			console.log(context);
			await context.resume();
			const ss = context.createMediaStreamSource(media);
			console.log(media, ss);
			new Audio().srcObject = media; //weird I know, but it's for chromium/webkit bug
			ss.connect(context.destination);
			this.recivers.add(e.receiver);
			console.log(this.recivers);
		};
		const __minimalStreamViewer =
			this.settings.isStreamViewer &&
			(typeof (globalThis as unknown as { __minimalStreamViewer?: boolean }).__minimalStreamViewer === "boolean"
				? (globalThis as unknown as { __minimalStreamViewer?: boolean }).__minimalStreamViewer
				: (typeof (window as unknown as { __minimalStreamViewer?: boolean }).__minimalStreamViewer === "boolean"
					? (window as unknown as { __minimalStreamViewer?: boolean }).__minimalStreamViewer
					: false));

		if (__minimalStreamViewer) {
			// Minimal stream viewer: only 1 audio + 1 video transceiver (may fix black video demux)
			pc.addTransceiver("audio", {
				direction: "inactive",
				streams: [],
				sendEncodings: [{active: true, maxBitrate: this.settings.bitrate}],
			});
			pc.addTransceiver("video", {
				direction: "inactive",
				streams: [],
				sendEncodings: [{active: true, maxBitrate: this.settings.bitrate}],
			});
			console.log("[Voice] Minimal stream viewer: 1 audio + 1 video transceiver");
		} else if (!this.settings.stream) {
			try {
				const audioStream = await navigator.mediaDevices.getUserMedia({video: false, audio: true});
				const [track] = audioStream.getAudioTracks();
				if (track) {
					this.setupMic(audioStream);
					const sender = pc.addTrack(track);
					this.mic = sender;
					this.micTrack = track;
					track.enabled = !this.owner.mute;
					this.senders.add(sender);
					console.log(sender);
				} else {
					pc.addTransceiver("audio", {
						direction: "inactive",
						streams: [],
						sendEncodings: [{active: true, maxBitrate: this.settings.bitrate}],
					});
				}
			} catch (err) {
				// No mic available, permission denied, or device in use: connect without sending audio
				console.warn("Mic unavailable, connecting without audio send:", err);
				pc.addTransceiver("audio", {
					direction: "inactive",
					streams: [],
					sendEncodings: [{active: true, maxBitrate: this.settings.bitrate}],
				});
			}
		} else if (!this.settings.isStreamViewer) {
			// Only create inactive audio for non-viewer streams (streamers)
			// Stream viewers skip this and create recvonly transceivers below
			pc.addTransceiver("audio", {
				direction: "inactive",
				streams: [],
				sendEncodings: [{active: true, maxBitrate: this.settings.bitrate}],
			});
		}
		if (!__minimalStreamViewer) {
			const bitrate = this.settings.bitrate || 2500000;
			// #region agent log
			DEBUG_INGEST_URL&&fetch(DEBUG_INGEST_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voice.ts:startWebRTC-createTransceivers',message:'About to create video transceiver',data:{isStreamViewer:this.settings.isStreamViewer,isStream:this.settings.stream,hasLive:!!this.settings.live},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'HA'})}).catch(()=>{});
			// #endregion
			// VIEWER FIX: Stream viewers should NOT create sendonly video transceivers.
			// They need recvonly to receive the producer's video stream.
			if (this.settings.isStreamViewer) {
				// For stream viewers: create ONLY 1 video transceiver (recvonly) — no audio for now.
				pc.addTransceiver("video", {
					direction: "recvonly",
					streams: [],
				});
				// #region agent log
				DEBUG_INGEST_URL&&fetch(DEBUG_INGEST_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voice.ts:startWebRTC-viewerTransceivers',message:'Created recvonly video transceiver for stream viewer',data:{transceiverCount:pc.getTransceivers().length,directions:pc.getTransceivers().map(t=>({kind:t.receiver.track?.kind||'unknown',direction:t.direction}))},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'HA'})}).catch(()=>{});
				// #endregion
				console.log("[voice] Stream viewer: created 1 video transceiver (recvonly), no audio");
			} else {
				// Non-viewer (streamer or regular voice): create sendonly video + extra transceivers
				this.cam = pc.addTransceiver("video", {
					direction: "sendonly",
					streams: [],
					sendEncodings: [
						{active: true, maxBitrate: bitrate, scaleResolutionDownBy: 1, maxFramerate: 20},
					],
				});
				const count = this.settings.stream ? 1 : 10;
				for (let i = 0; i < count; i++) {
					pc.addTransceiver("audio", {
						direction: "inactive",
						streams: [],
						sendEncodings: [{active: true, maxBitrate: this.settings.bitrate}],
					});
				}
				if (this.settings.live) {
					this.cam = pc.addTransceiver("video", {
						direction: "sendonly",
						streams: [],
						sendEncodings: [
							{active: true, maxBitrate: bitrate, scaleResolutionDownBy: 1, maxFramerate: 20},
						],
					});
					// CRITICAL: Assign this.pc NOW so startVideo can use it correctly
					this.pc = pc;
					await this.startVideo(this.settings.live);
					this.makeOp12();
				} else {
					for (let i = 0; i < count; i++) {
						pc.addTransceiver("video", {
							direction: "inactive",
							streams: [],
							sendEncodings: [{active: true, maxBitrate: this.settings.bitrate}],
						});
					}
				}
			}
		}

		this.pc = pc;
		this.negotationneeded();
		await new Promise((res) => setTimeout(res, 100));
		let sdp = this.offer;
		if (!sdp) {
			const offer = await this.makeOffer();
			this.status = "startingRTC";
			sdp = offer.sdp;
			this.offer = sdp;
		}

		// Only set local description if not already done (negotiationneeded might have set it)
		if (pc.signalingState === "stable") {
			await pc.setLocalDescription();
		}
		// #region agent log
		const offerSdp = pc.localDescription?.sdp || '';
		const videoDirections = offerSdp.match(/a=(sendonly|recvonly|sendrecv|inactive)/g) || [];
		const videoMlines = offerSdp.split('\nm=video').slice(1).map((s:string) => 'm=video' + s.split('\nm=')[0].substring(0, 200));
		DEBUG_INGEST_URL&&fetch(DEBUG_INGEST_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voice.ts:startWebRTC-afterSetLocal',message:'Offer SDP created',data:{isStreamViewer:this.settings.isStreamViewer,isStream:this.settings.stream,mlineCount:(offerSdp.match(/^m=/gm)||[]).length,directions:videoDirections,videoMlinePreview:videoMlines.slice(0,2),transceiverDirections:pc.getTransceivers().map(t=>({kind:t.receiver.track?.kind||'unknown',direction:t.direction,mid:t.mid}))},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'HA'})}).catch(()=>{});
		// #endregion
		if (!sdp) {
			this.status = "noSDP";
			this.ws?.close();
			return;
		}
		const parsed = Voice.parsesdp(sdp);
		const video = new Map<string, [number, number]>();
		const audio = new Map<string, number>();
		let cur: [number, number] | undefined;
		let i = 0;
		for (const thing of parsed.medias) {
			try {
				if (thing.media === "video") {
					const rtpmap = thing.atr.get("rtpmap");
					if (!rtpmap) continue;
					for (const codecpair of rtpmap) {
						const [port, codec] = codecpair.split(" ");
						if (cur && codec.split("/")[0] === "rtx") {
							cur[1] = Number(port);
							cur = undefined;
							continue;
						}
						if (video.has(codec.split("/")[0])) continue;
						cur = [Number(port), -1];
						video.set(codec.split("/")[0], cur);
					}
				} else if (thing.media === "audio") {
					const rtpmap = thing.atr.get("rtpmap");
					if (!rtpmap) continue;
					for (const codecpair of rtpmap) {
						const [port, codec] = codecpair.split(" ");
						if (audio.has(codec.split("/")[0])) {
							continue;
						}
						audio.set(codec.split("/")[0], Number(port));
					}
				}
			} finally {
				i++;
			}
		}

		const codecs: {
			name: string;
			type: "video" | "audio";
			priority: number;
			payload_type: number;
			rtx_payload_type: number | null;
		}[] = [];
		const include = new Set<string>();
		const audioAlloweds = new Map([["opus", {priority: 1000}]]);
		for (const thing of audio) {
			if (audioAlloweds.has(thing[0])) {
				include.add(thing[0]);
				codecs.push({
					name: thing[0],
					type: "audio",
					priority: audioAlloweds.get(thing[0])?.priority as number,
					payload_type: thing[1],
					rtx_payload_type: null,
				});
			}
		}
		const videoAlloweds = new Map([
			["H264", {priority: 1000}],
			["VP8", {priority: 2000}],
			["VP9", {priority: 3000}],
		]);
		for (const thing of video) {
			if (videoAlloweds.has(thing[0])) {
				include.add(thing[0]);
				codecs.push({
					name: thing[0],
					type: "video",
					priority: videoAlloweds.get(thing[0])?.priority as number,
					payload_type: thing[1][0],
					rtx_payload_type: thing[1][1],
				});
			}
		}
		let sendsdp = "a=extmap-allow-mixed";
		let first = true;

		for (const media of parsed.medias) {
			for (const thing of first
				? (["ice-ufrag", "ice-pwd", "ice-options", "fingerprint", "extmap", "rtpmap"] as const)
				: (["extmap", "rtpmap"] as const)) {
				let thing2 = media.atr.get(thing);
				if (!thing2) {
					thing2 = parsed.atr.get(thing);
					if (!thing2) {
						console.error("couldn't find " + thing);
						continue;
					}
				}
				for (const thing3 of thing2) {
					if (thing === "rtpmap") {
						const name = thing3.split(" ")[1].split("/")[0];
						if (include.has(name)) {
							include.delete(name);
						} else {
							continue;
						}
					}
					sendsdp += `\na=${thing}:${thing3}`;
				}
			}
			first = false;
		}
		console.log(sendsdp);
		// Server (mediasoup semantic-sdp) expects a full SDP starting with v=0, not the reduced sendsdp.
		const fullSdp = sdp ?? sendsdp;
		if (this.ws) {
			this.ws.send(
				JSON.stringify({
					d: {
						codecs,
						protocol: "webrtc",
						data: fullSdp,
						sdp: fullSdp,
					},
					op: 1,
				}),
			);
		}
		console.warn("done with this!");
	}
	static parsesdp(sdp: string) {
		let currentA = new Map<string, Set<string>>();
		const out: {
			version?: number;
			medias: {
				media: string;
				port: number;
				proto: string;
				ports: number[];
				atr: Map<string, Set<string>>;
			}[];
			atr: Map<string, Set<string>>;
		} = {medias: [], atr: currentA};
		for (const line of sdp.split("\n")) {
			const [code, setinfo] = line.split("=");
			switch (code) {
				case "v":
					out.version = Number(setinfo);
					break;
				case "o":
				case "s":
				case "t":
					break;
				case "m":
					currentA = new Map();
					const [media, port, proto, ...ports] = setinfo.split(" ");
					const portnums = ports.map(Number);
					out.medias.push({media, port: Number(port), proto, ports: portnums, atr: currentA});
					break;
				case "a":
					const [key, ...value] = setinfo.split(":");
					if (!currentA.has(key)) {
						currentA.set(key, new Set());
					}
					currentA.get(key)?.add(value.join(":"));
					break;
			}
		}
		return out;
	}
	open = false;
	async join() {
		console.warn("Joining");
		this.open = true;
		this.status = "waitingMainWS";
	}
	onMemberChange = (_member: memberjson | string, _joined: boolean) => {};
	userids = new Map<string, {deaf: boolean; muted: boolean; video: boolean; live: boolean}>();
	onUserChange = (
		_user: string,
		_change: {deaf: boolean; muted: boolean; video: boolean; live: boolean},
	) => {};
	async voiceupdate(update: voiceStatus) {
		console.log("Update!");
		if (!this.userids.has(update.user_id)) {
			this.onMemberChange(update?.member || update.user_id, true);
		}
		const vals = {
			deaf: update.deaf,
			muted: update.mute || update.self_mute,
			video: update.self_video,
			live: update.self_stream,
		};
		this.onUserChange(update.user_id, vals);
		this.userids.set(update.user_id, vals);
		if (update.user_id === this.userid && this.videoStarted !== update.self_video) {
			// Stream viewers receive video; they don't send op12 or show "sendingStreams"
			if (!this.settings.isStreamViewer) {
				this.makeOp12();
			}
			this.videoStarted = update.self_video;
		}
		if (update.user_id === this.userid && this.open && !this.ws) {
			if (!update) {
				this.status = "badWS";
				return;
			}
			this.session_id = update.session_id;
			await this.startWS(update.session_id, update.guild_id);
		}
	}
	session_id?: string;
	/** Prevents double startWS (e.g. two voice state updates) from opening two WS and orphaning the first. */
	private _wsConnecting = false;
	async startWS(session_id: string, server_id: string) {
		if (this._wsConnecting) {
			console.warn("[voice] startWS skipped: already connecting");
			return;
		}
		this._wsConnecting = true;
		try {
			if (!this.urlobj.url) {
				this.status = "waitingURL";
				const guildId = String(server_id ?? "");
				this.owner.ensureGuild(guildId);
				const guildUrlObj = this.owner.guildUrlMap.get(guildId);
				const getUrlPromise = guildUrlObj?.geturl ?? Promise.resolve();
				const VOICE_URL_TIMEOUT_MS = 15000;
				const timeoutPromise = new Promise<never>((_, reject) => {
					setTimeout(() => reject(new Error("VOICE_SERVER_UPDATE timeout")), VOICE_URL_TIMEOUT_MS);
				});
				try {
					await Promise.race([getUrlPromise, timeoutPromise]);
				} catch (e) {
					console.warn("[voice] Voice URL timeout (" + VOICE_URL_TIMEOUT_MS + "ms), leaving so you can retry");
					this._wsConnecting = false;
					this.leave();
					return;
				}
				if (!this.open) {
					console.warn("[voice] leave: !open after geturl");
					this._wsConnecting = false;
					this.leave();
					return;
				}
				const resolved = this.owner.guildUrlMap.get(guildId);
				if (resolved?.url) {
					this.urlobj.url = resolved.url;
					this.urlobj.token = resolved.token;
				}
				if (!this.urlobj.url) {
					console.warn("[voice] No URL after geturl resolved, leaving");
					this._wsConnecting = false;
					this.leave();
					return;
				}
			}

			const ws = new WebSocket(
				((this.owner.secure ? "wss://" : "ws://") + this.urlobj.url) as string,
			);
			this.ws = ws;
			ws.onclose = (ev: CloseEvent) => {
				console.warn("[voice] ws.onclose code=" + (ev?.code ?? "?") + " reason=" + (ev?.reason ?? ""));
				this.leave();
			};
			this.status = "wsOpen";
			ws.addEventListener("message", (m) => {
				this.packet(m);
			});
			await new Promise<void>((res) => {
				ws.addEventListener("open", () => {
					res();
				});
			});
			if (!this.ws) {
				console.warn("[voice] leave: !this.ws after open");
				this.leave();
				return;
			}
			this.status = "wsAuth";
			ws.send(
				JSON.stringify({
					op: 0,
					d: {
						server_id,
						user_id: this.userid,
						session_id,
						token: this.urlobj.token,
						max_secure_frames_version: 0,
						video: !!this.settings.live,
						streams: [
							{
								type: this.settings.live ? "screen" : "video",
								rid: "100",
								quality: 100,
							},
						],
					},
				}),
			);
		} finally {
			this._wsConnecting = false;
		}
	}
	onLeave = () => {};
	async leave() {
		// Instrumentation: log why leave() was called (keep until issue is resolved)
		const stack = new Error().stack ?? "";
		const leaveReason =
			stack.includes("ws.onclose") ? "ws.onclose" :
			stack.includes("startWS") ? "startWS" :
			stack.includes("disconnect") ? "disconnect" :
			stack.includes("joinVoice") ? "joinVoice" :
			stack.includes("leaveLive") ? "leaveLive" :
			"other";
		console.warn("[voice] leave() called, reason:", leaveReason, "userid:", this.userid, "curChan:", this.owner.curChan);
		this._wsConnecting = false;
		this.open = false;
		this.status = "left";
		if (!this.settings.stream) this.owner.video = false;
		this.onLeave();

		for (const thing of this.liveMap) {
			this.leaveLive(thing[0]);
		}
		if (!this.settings.stream) {
			this.onMemberChange(this.userid, false);
		}
		this.userids.delete(this.userid);
		if (this.ws) {
			this.ws.close();
			this.ws = undefined;
		}
		if (this.pc) {
			this.pc.close();
			this.pc = undefined;
		}
		this.micTrack?.stop();
		this.micTrack = undefined;
		this.mic = undefined;
		this.off = undefined;
		this.counter = undefined;
		this.offer = undefined;
		this.senders = new Set();
		this.recivers = new Set();
		this.ssrcMap = new Map();
		this.fingerprint = undefined;
		this.users = new Map();
		if (!this.settings.stream) this.owner.disconect();
		this.vidusers = new Map();
		this.codecInfo = {};
		this.videos = new Map();
		if (this.cammera) this.cammera.stop();
		this.cammera = undefined;
		this.cam = undefined;
		console.log(this);
	}
}
export {Voice, VoiceFactory};
