import { getBulkInfo, getBulkUsers, Specialuser } from "./utils/utils.js";
import { getPreferences } from "./utils/storage/userPreferences.js";
import { I18n } from "./i18n.js";

// OPERATOR is bit 0 in Spacebar rights
const OPERATOR_BIT = 1;

function hasOperator(rights: number): boolean {
	return (rights & OPERATOR_BIT) !== 0;
}

async function getCurrentUser(): Promise<Specialuser | null> {
	await getBulkUsers();
	const info = getBulkInfo();
	if (!info?.users) return null;
	const current = sessionStorage.getItem("currentuser") || info.currentuser;
	if (!current || !info.users[current]) return null;
	return new Specialuser(info.users[current]);
}

if (window.location.pathname.startsWith("/admin")) {
	(async () => {
		await I18n.done;
		const prefs = await getPreferences();
		document.body.className = prefs.theme + "-theme";

		const user = await getCurrentUser();
		if (!user) {
			document.body.replaceChildren(
				Object.assign(document.createElement("div"), {
					className: "admin-denied",
					innerHTML: `<p>${I18n.admin?.accessDenied?.() ?? "Access denied. Please log in."}</p><a href="/">${I18n.home?.goHome?.() ?? "Home"}</a>`,
				}),
			);
			return;
		}

		let whoami: { rights?: number };
		try {
			const r = await fetch(user.serverurls.api + "/_spacebar/admin/whoami", {
				headers: { Authorization: user.token },
			});
			if (!r.ok) throw new Error(String(r.status));
			whoami = await r.json();
		} catch {
			document.body.replaceChildren(
				Object.assign(document.createElement("div"), {
					className: "admin-denied",
					innerHTML: `<p>${I18n.admin?.accessDenied?.() ?? "Access denied."}</p><a href="/channels/@me">${I18n.home?.goHome?.() ?? "Home"}</a>`,
				}),
			);
			return;
		}

		if (!hasOperator(whoami.rights ?? 0)) {
			document.body.replaceChildren(
				Object.assign(document.createElement("div"), {
					className: "admin-denied",
					innerHTML: `<p>${I18n.admin?.accessDenied?.() ?? "Access denied. Operator rights required."}</p><a href="/channels/@me">${I18n.home?.goHome?.() ?? "Home"}</a>`,
				}),
			);
			return;
		}

		const api = user.serverurls.api;
		const headers = { "Content-Type": "application/json", Authorization: user.token };

		const root = document.createElement("div");
		root.id = "admin-root";
		root.className = "admin-page";

		const nav = document.createElement("nav");
		nav.className = "admin-nav";
		const tabs = ["Users", "Guilds", "Config", "Stickers"] as const;
		const content = document.createElement("div");
		content.className = "admin-content";

		function showTab(name: (typeof tabs)[number]) {
			content.innerHTML = "";
			content.appendChild(renderTab(name));
		}

		function renderTab(name: (typeof tabs)[number]): HTMLElement {
			const wrap = document.createElement("div");
			wrap.className = "admin-tab";

			if (name === "Users") {
				const tbl = document.createElement("table");
				tbl.className = "admin-table";
				wrap.appendChild(tbl);
				fetch(api + "/_spacebar/admin/users", { headers: { Authorization: user!.token } })
					.then((r) => r.json())
					.then((arr: { id: string; username: string; discriminator: string; bot: boolean; created_at?: string }[]) => {
						tbl.innerHTML = `<thead><tr><th>ID</th><th>Username</th><th>Discriminator</th><th>Bot</th><th></th></tr></thead><tbody></tbody>`;
						const tbody = tbl.querySelector("tbody")!;
						for (const u of arr) {
							const tr = document.createElement("tr");
							tr.innerHTML = `<td>${u.id}</td><td>${u.username}</td><td>${u.discriminator}</td><td>${u.bot ? "✓" : ""}</td><td><button class="admin-btn admin-btn-danger" data-delete-user="${u.id}">${I18n.admin?.delete?.() ?? "Delete"}</button></td>`;
							tr.querySelector("[data-delete-user]")?.addEventListener("click", async () => {
								if (!confirm(I18n.admin?.confirmDeleteUser?.() ?? "Delete this user?")) return;
								try {
									const res = await fetch(api + `/_spacebar/admin/users/${u.id}/delete`, { headers: { Authorization: user!.token } });
									if (res.ok) {
										tr.remove();
									} else alert((await res.json())?.message ?? "Failed");
								} catch (e) {
									alert("Error: " + (e as Error).message);
								}
							});
							tbody.appendChild(tr);
						}
					})
					.catch((e) => {
						wrap.appendChild(document.createTextNode("Error: " + (e as Error).message));
					});
			} else if (name === "Guilds") {
				const tbl = document.createElement("table");
				tbl.className = "admin-table";
				wrap.appendChild(tbl);
				fetch(api + "/_spacebar/admin/Guilds", { headers: { Authorization: user!.token } })
					.then((r) => r.json())
					.then((arr: { id: string; name: string; owner_id?: string; member_count?: number }[]) => {
						tbl.innerHTML = `<thead><tr><th>ID</th><th>Name</th><th>Owner</th><th>Members</th><th></th></tr></thead><tbody></tbody>`;
						const tbody = tbl.querySelector("tbody")!;
						for (const g of arr) {
							const tr = document.createElement("tr");
							tr.innerHTML = `<td>${g.id}</td><td>${g.name}</td><td>${g.owner_id ?? ""}</td><td>${g.member_count ?? 0}</td><td><button class="admin-btn" data-force-join="${g.id}">${I18n.admin?.forceJoin?.() ?? "Force join"}</button></td>`;
							tr.querySelector("[data-force-join]")?.addEventListener("click", async () => {
								const user_id = prompt(I18n.admin?.userIdPrompt?.() ?? "User ID (empty = yourself):") || undefined;
								const make_owner = confirm(I18n.admin?.makeOwner?.() ?? "Make owner?");
								const make_admin = confirm(I18n.admin?.makeAdmin?.() ?? "Make admin?");
								try {
									const res = await fetch(api + `/_spacebar/admin/Guilds/${g.id}/force_join`, {
										method: "POST",
										headers,
										body: JSON.stringify({ user_id, make_owner, make_admin }),
									});
									if (res.ok) alert(I18n.admin?.forceJoinDone?.() ?? "Done.");
									else alert((await res.json())?.message ?? "Failed");
								} catch (e) {
									alert("Error: " + (e as Error).message);
								}
							});
							tbody.appendChild(tr);
						}
					})
					.catch((e) => {
						wrap.appendChild(document.createTextNode("Error: " + (e as Error).message));
					});
			} else if (name === "Config") {
				const btn = document.createElement("button");
				btn.className = "admin-btn";
				btn.textContent = I18n.admin?.reloadConfig?.() ?? "Reload config";
				btn.onclick = async () => {
					try {
						const res = await fetch(api + "/_spacebar/admin/Configuration/ReloadConfig", { method: "POST", headers: { Authorization: user!.token } });
						if (res.ok) alert(I18n.admin?.reloadConfigDone?.() ?? "Config reloaded.");
						else alert("Failed");
					} catch (e) {
						alert("Error: " + (e as Error).message);
					}
				};
				wrap.appendChild(btn);
			} else if (name === "Stickers") {
				const tbl = document.createElement("table");
				tbl.className = "admin-table";
				wrap.appendChild(tbl);
				fetch(api + "/_spacebar/admin/media/sticker", { headers: { Authorization: user!.token } })
					.then((r) => r.json())
					.then((arr: { id: string; name: string; description?: string; type?: number; format_type?: number }[]) => {
						tbl.innerHTML = `<thead><tr><th>ID</th><th>Name</th><th>Description</th><th>Type</th><th>Format</th></tr></thead><tbody></tbody>`;
						const tbody = tbl.querySelector("tbody")!;
						for (const s of arr) {
							const tr = document.createElement("tr");
							tr.innerHTML = `<td>${s.id}</td><td>${s.name}</td><td>${s.description ?? ""}</td><td>${s.type ?? ""}</td><td>${s.format_type ?? ""}</td>`;
							tbody.appendChild(tr);
						}
					})
					.catch((e) => {
						wrap.appendChild(document.createTextNode("Error: " + (e as Error).message));
					});
			}

			return wrap;
		}

		for (const t of tabs) {
			const btn = document.createElement("button");
			btn.className = "admin-tab-btn";
			btn.textContent = I18n.admin?.[t.toLowerCase() as "users" | "guilds" | "config" | "stickers"]?.() ?? t;
			btn.onclick = () => {
				nav.querySelectorAll(".admin-tab-btn").forEach((b) => b.classList.remove("active"));
				btn.classList.add("active");
				showTab(t);
			};
			nav.appendChild(btn);
		}

		root.appendChild(nav);
		root.appendChild(content);
		document.body.replaceChildren(root);

		(nav.querySelector(".admin-tab-btn") as HTMLButtonElement)?.click();
	})();
}
