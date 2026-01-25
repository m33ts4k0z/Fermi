import {I18n} from "./i18n.js";
import {makeRegister} from "./register.js";
import {getapiurls, getBulkInfo} from "./utils/utils.js";

interface InstanceData {
	name: string;
	description?: string;
	descriptionLong?: string;
	image?: string;
	url?: string;
	display?: boolean;
	online?: boolean;
	uptime?: {alltime: number; daytime: number; weektime: number};
	urls?: {
		wellknown: string;
		api: string;
		cdn: string;
		gateway: string;
		login?: string;
	};
}

async function checkInstanceHealth(instance: InstanceData): Promise<boolean> {
	try {
		let api = instance.urls?.api;
		if (!api && instance.url) {
			const urls = await getapiurls(instance.url);
			api = urls?.api;
		}
		if (!api) {
			console.log(`Checking health for ${instance.name}: No API`);
			return false;
		}

		const response = await fetch(`${api}/ping`, {method: "GET"});
		console.log(`Checking health for ${instance.name}: ${response.status}`);
		return response.ok;
	} catch (e) {
		console.log(`Checking health for ${instance.name}: Error`);
		return false;
	}
}

function getSavedServers(): InstanceData[] {
	const userInfo = getBulkInfo();
	if (!userInfo?.users) return [];

	const servers: InstanceData[] = [];
	const seen = new Set<string>();

	for (const key of Object.keys(userInfo.users)) {
		const user = userInfo.users[key];
		if (!user?.serverurls?.wellknown) continue;

		const wellknown = user.serverurls.wellknown;
		if (seen.has(wellknown)) continue;
		seen.add(wellknown);

		servers.push({
			name: new URL(wellknown).hostname,
			url: wellknown,
			urls: user.serverurls,
			description: "Saved server",
		});
	}

	return servers;
}
if (window.location.pathname === "/" || window.location.pathname.startsWith("/index")) {
	const serverbox = document.getElementById("instancebox") as HTMLDivElement;

	(async () => {
		await I18n.done;
		const box1Items = document.getElementById("box1Items");
		I18n.translatePage();

		if (box1Items) {
			const items = I18n.htmlPages.box1Items().split("|");
			let i = 0;
			//@ts-ignore ts is being dumb here
			for (const item of box1Items.children) {
				(item as HTMLElement).textContent = items[i];
				i++;
			}
		}
	})();
	const recent = document.getElementById("recentBlog");
	if (recent) {
		fetch("https://blog.fermi.chat/feed_json_created.json")
			.then((_) => _.json())
			.then(
				(json: {
					items: {
						url: string;
						title: string;
						content_html: string;
					}[];
				}) => {
					for (const thing of json.items.slice(0, 5)) {
						const a = document.createElement("a");
						a.href = thing.url;
						a.textContent = thing.title;
						recent.append(a);
					}
				},
			);
	}
	// Check for saved servers in localStorage first
	const savedServers = getSavedServers();

	async function displayInstances(instances: InstanceData[]) {
		await I18n.done;
		for (const instance of instances) {
			if (instance.display === false) {
				continue;
			}
			const div = document.createElement("div");
			div.classList.add("flexltr", "instance");
			if (instance.image) {
				const img = document.createElement("img");
				img.alt = I18n.home.icon(instance.name);
				img.src = instance.image;
				div.append(img);
			}
			const statbox = document.createElement("div");
			statbox.classList.add("flexttb", "flexgrow");

			// Track online status for click handler
			let isOnline: boolean | undefined = undefined;

			{
				const textbox = document.createElement("div");
				textbox.classList.add("flexttb", "instancetextbox");
				const title = document.createElement("h2");
				title.innerText = instance.name;
				textbox.append(title);

				if (instance.description || instance.descriptionLong) {
					const p = document.createElement("p");
					if (instance.descriptionLong) {
						p.innerText = instance.descriptionLong;
					} else if (instance.description) {
						p.innerText = instance.description;
					}
					textbox.append(p);
				}
				statbox.append(textbox);
			}

			// Run health check asynchronously, log to console
			checkInstanceHealth(instance).then((online) => {
				isOnline = online;
			});

			div.append(statbox);
			div.onclick = (_) => {
				if (isOnline !== false) {
					makeRegister(true, instance.name);
				} else {
					alert(I18n.home.warnOffiline());
				}
			};
			serverbox.append(div);
		}
	}

	if (savedServers.length > 0) {
		// Use saved servers from localStorage, skip instances.json
		displayInstances(savedServers);
	} else {
		// No saved servers, fetch from instances.json
		fetch("/instances.json")
			.then((_) => _.json())
			.then((json: InstanceData[]) => displayInstances(json));
	}

	const slides = document.getElementById("ScreenshotSlides");
	if (slides) {
		const images = Array.from(slides.getElementsByTagName("img"));
		const left = slides.getElementsByClassName("leftArrow").item(0) as HTMLElement;
		const right = slides.getElementsByClassName("rightArrow").item(0) as HTMLElement;
		let index = 0;
		let timeout: NodeJS.Timeout | undefined = setTimeout(() => {});
		function slideShow() {
			let cleared = false;
			if (timeout !== undefined) {
				cleared = true;
				clearTimeout(timeout);
			}
			let i = 0;
			for (const img of images) {
				if (i !== index) {
					img.classList.add("hidden");
				} else {
					img.classList.remove("hidden");
				}
				i++;
			}
			const count = document.getElementById("slideCount");
			if (count) {
				if (count.children.length !== images.length) {
					count.innerHTML = "";
					for (let i = 0; i < images.length; i++) {
						const dot = document.createElement("span");
						const outer = document.createElement("div");
						outer.onclick = () => {
							index = i;
							slideShow();
						};
						outer.append(dot);
						count.append(outer);
					}
				}
				let i = 0;
				for (const child of Array.from(count.children)) {
					if (i === index) {
						child.classList.add("selected");
					} else {
						child.classList.remove("selected");
					}
					i++;
				}
			}

			timeout = setTimeout(
				() => {
					index = (index + 1) % images.length;
					timeout = undefined;
					slideShow();
				},
				cleared ? 15000 : 30000,
			);
		}
		slideShow();
		left.onclick = () => {
			index = (index - 1 + images.length) % images.length;
			slideShow();
		};
		right.onclick = () => {
			index = (index + 1) % images.length;
			slideShow();
		};
	}
}
