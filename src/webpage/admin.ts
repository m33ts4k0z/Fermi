import { getBulkInfo, getBulkUsers, Specialuser } from "./utils/utils.js";
import { getPreferences } from "./utils/storage/userPreferences.js";
import { I18n } from "./i18n.js";
import { Rights } from "./rights.js";

/** Admin panel access: OPERATOR or MANAGE_USERS (discord-like admins often lack OPERATOR). */
function canAccessAdminPanel(rights: number | string | undefined | null): boolean {
	if (rights === undefined || rights === null) return false;
	const r = new Rights(typeof rights === "string" ? rights : String(rights));
	return r.hasPermission("OPERATOR", false) || r.hasPermission("MANAGE_USERS", false);
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

		let whoami: { rights?: number; rights_string?: string };
		try {
			const r = await fetch(user.serverurls.api + "/_spacebar/admin/whoami", {
				headers: { Authorization: user.token },
			});
			if (!r.ok) throw new Error(String(r.status));
			whoami = await r.json();
		} catch (e) {
			const msg = String((e as Error).message).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
			document.body.replaceChildren(
				Object.assign(document.createElement("div"), {
					className: "admin-denied",
					innerHTML: `<p>${I18n.admin?.accessDenied?.() ?? "Access denied."}</p><p style="font-size:0.9em;margin-top:8px">${msg}</p><p style="font-size:0.85em;margin-top:4px;opacity:0.9">If you see 401, try logging out and back in to get a fresh token.</p><a href="/channels/@me">${I18n.home?.goHome?.() ?? "Home"}</a>`,
				}),
			);
			return;
		}

		const rightsValue = whoami.rights_string ?? whoami.rights;
		if (!canAccessAdminPanel(rightsValue)) {
			const displayedRights = rightsValue !== undefined && rightsValue !== null ? String(rightsValue) : "(empty)";
			document.body.replaceChildren(
				Object.assign(document.createElement("div"), {
					className: "admin-denied",
					innerHTML: `<p>${I18n.admin?.accessDenied?.() ?? "Access denied. Operator or Manage Users rights required."}</p><p style="font-size:0.9em;margin-top:8px">Your rights value: <code>${displayedRights}</code>. Ensure this account has OPERATOR or MANAGE_USERS in the database.</p><a href="/channels/@me">${I18n.home?.goHome?.() ?? "Home"}</a>`,
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
				const topBar = document.createElement("div");
				topBar.className = "admin-users-top";
				topBar.style.marginBottom = "12px";
				const createBtn = document.createElement("button");
				createBtn.className = "admin-btn";
				createBtn.textContent = I18n.admin?.createUser?.() ?? "Create user";
				topBar.appendChild(createBtn);
				wrap.appendChild(topBar);

				const tbl = document.createElement("table");
				tbl.className = "admin-table";
				wrap.appendChild(tbl);

				type UserRow = { id: string; username: string; discriminator: string; bot: boolean; created_at?: string; rights?: string };
				function renderUsersTable(arr: UserRow[]) {
					tbl.innerHTML = `<thead><tr><th>ID</th><th>Username</th><th>Discriminator</th><th>Bot</th><th>Rights</th><th>Created</th><th></th></tr></thead><tbody></tbody>`;
					const tbody = tbl.querySelector("tbody")!;
					for (const u of arr) {
						const tr = document.createElement("tr");
						const rightsPreview = u.rights != null ? String(u.rights) : "";
						const created = u.created_at ? new Date(u.created_at).toLocaleDateString() : "";
						tr.innerHTML = `<td title="${u.id}">${u.id.slice(0, 8)}…</td><td>${escapeHtml(u.username)}</td><td>${escapeHtml(u.discriminator)}</td><td>${u.bot ? "✓" : ""}</td><td title="${rightsPreview}">${rightsPreview ? rightsPreview.slice(0, 10) + "…" : "0"}</td><td>${created}</td><td><button class="admin-btn admin-btn-edit" data-edit-user="${u.id}">${I18n.admin?.edit?.() ?? "Edit"}</button> <button class="admin-btn admin-btn-danger" data-delete-user="${u.id}">${I18n.admin?.delete?.() ?? "Delete"}</button></td>`;
						tr.querySelector("[data-delete-user]")?.addEventListener("click", async () => {
							if (!confirm(I18n.admin?.confirmDeleteUser?.() ?? "Delete this user?")) return;
							try {
								const res = await fetch(api + `/_spacebar/admin/users/${u.id}/delete`, { headers: { Authorization: user!.token } });
								if (res.ok) tr.remove();
								else alert((await res.json())?.message ?? "Failed");
							} catch (e) {
								alert("Error: " + (e as Error).message);
							}
						});
						tr.querySelector("[data-edit-user]")?.addEventListener("click", () => openEditModal(u.id));
						tbody.appendChild(tr);
					}
				}

				function escapeHtml(s: string): string {
					const div = document.createElement("div");
					div.textContent = s;
					return div.innerHTML;
				}

				function randomPassword(): string {
					const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%&*";
					let out = "";
					const buf = new Uint8Array(20);
					crypto.getRandomValues(buf);
					for (let i = 0; i < 20; i++) out += chars[buf[i]! % chars.length];
					return out;
				}

				function renderRightsCheckboxes(container: HTMLElement, currentRights: string | number) {
					container.innerHTML = "";
					const r = new Rights(typeof currentRights === "string" ? currentRights : String(currentRights));
					const grid = document.createElement("div");
					grid.className = "admin-rights-grid";
					grid.style.display = "grid";
					grid.style.gridTemplateColumns = "repeat(auto-fill, minmax(200px, 1fr))";
					grid.style.gap = "6px 12px";
					grid.style.marginTop = "8px";
					for (const name of Rights.permisions) {
						const label = document.createElement("label");
						label.style.display = "flex";
						label.style.alignItems = "center";
						label.style.gap = "6px";
						const cb = document.createElement("input");
						cb.type = "checkbox";
						cb.dataset.right = name;
						cb.checked = r.getPermission(name);
						label.appendChild(cb);
						label.appendChild(document.createTextNode(name));
						grid.appendChild(label);
					}
					container.appendChild(grid);
				}

				function getRightsFromCheckboxes(container: HTMLElement): string {
					const r = new Rights(0);
					container.querySelectorAll<HTMLInputElement>("input[data-right]").forEach((cb) => {
						const name = cb.dataset.right;
						if (name) r.setPermission(name, cb.checked ? 1 : 0);
					});
					return r.allow.toString();
				}

				function bindRightsSearch(rightsContainer: HTMLElement, searchInput: HTMLInputElement | null) {
					if (!searchInput) return;
					const filter = () => {
						const q = searchInput.value.trim().toLowerCase();
						rightsContainer.querySelectorAll<HTMLInputElement>("input[data-right]").forEach((cb) => {
							const label = cb.closest("label");
							if (!label) return;
							const name = (cb.dataset.right ?? "").toLowerCase();
							(label as HTMLElement).style.display = !q || name.includes(q) ? "" : "none";
						});
					};
					searchInput.addEventListener("input", filter);
					searchInput.addEventListener("keydown", (e) => e.stopPropagation());
				}

				function openCreateModal() {
					const modal = document.createElement("div");
					modal.className = "admin-modal-overlay";
					modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:9999";
					const box = document.createElement("div");
					box.className = "admin-modal";
					box.style.cssText = "background:var(--primary-bg);padding:20px;border-radius:8px;max-width:520px;max-height:90vh;overflow:auto;color:var(--primary-text)";
					box.innerHTML = `<h3 style="margin:0 0 12px">${I18n.admin?.createUser?.() ?? "Create user"}</h3>`;
					const form = document.createElement("div");
					form.innerHTML = `
						<div style="margin-bottom:10px"><label>Username <input type="text" name="username" required minlength="2" style="width:100%;box-sizing:border-box"></label></div>
						<div style="margin-bottom:10px"><label>Email <input type="email" name="email" style="width:100%;box-sizing:border-box"></label></div>
						<div style="margin-bottom:10px"><label>Password <input type="text" name="password" style="width:100%;box-sizing:border-box"> <button type="button" class="admin-btn admin-btn-random-pw">${I18n.admin?.generateRandom?.() ?? "Generate random"}</button></label></div>
						<div><strong>Rights</strong><input type="text" class="admin-rights-search" placeholder="Filter rights..." style="width:100%;box-sizing:border-box;padding:6px;margin-top:6px"><div class="admin-rights-container"></div></div>
					`;
					const rightsContainer = form.querySelector(".admin-rights-container") as HTMLElement;
					renderRightsCheckboxes(rightsContainer, "0");
					bindRightsSearch(rightsContainer, form.querySelector<HTMLInputElement>(".admin-rights-search"));
					form.querySelector(".admin-btn-random-pw")?.addEventListener("click", () => {
						const input = form.querySelector<HTMLInputElement>("input[name=password]");
						if (input) {
							input.value = randomPassword();
							input.type = "text";
							navigator.clipboard?.writeText(input.value).then(() => {}, () => {});
						}
					});
					box.appendChild(form);
					const buttons = document.createElement("div");
					buttons.style.marginTop = "16px";
					const submitBtn = document.createElement("button");
					submitBtn.className = "admin-btn";
					submitBtn.textContent = I18n.admin?.create?.() ?? "Create";
					const cancelBtn = document.createElement("button");
					cancelBtn.className = "admin-btn";
					cancelBtn.textContent = I18n.admin?.cancel?.() ?? "Cancel";
					cancelBtn.onclick = () => modal.remove();
					submitBtn.onclick = async () => {
						const username = (form.querySelector<HTMLInputElement>("input[name=username]")?.value ?? "").trim();
						if (!username) {
							alert("Username required");
							return;
						}
						const email = form.querySelector<HTMLInputElement>("input[name=email]")?.value?.trim();
						const password = form.querySelector<HTMLInputElement>("input[name=password]")?.value;
						const rights = getRightsFromCheckboxes(form);
						try {
							const res = await fetch(api + "/_spacebar/admin/users", {
								method: "POST",
								headers,
								body: JSON.stringify({ username, email: email || undefined, password: password || undefined, rights }),
							});
							if (!res.ok) {
								const j = await res.json().catch(() => ({}));
								alert(j.message ?? "Failed");
								return;
							}
							const data = await res.json();
							modal.remove();
							if (data.generated_password) alert(`User created. Generated password (copy now): ${data.generated_password}`);
							fetch(api + "/_spacebar/admin/users", { headers: { Authorization: user!.token } }).then((r) => r.json()).then(renderUsersTable);
						} catch (e) {
							alert("Error: " + (e as Error).message);
						}
					};
					buttons.append(submitBtn, " ", cancelBtn);
					box.appendChild(buttons);
					modal.appendChild(box);
					box.onclick = (e) => e.stopPropagation();
					modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
					document.body.appendChild(modal);
				}

				function openEditModal(userId: string) {
					const modal = document.createElement("div");
					modal.className = "admin-modal-overlay";
					modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:9999";
					const box = document.createElement("div");
					box.className = "admin-modal";
					box.style.cssText = "background:var(--primary-bg);padding:20px;border-radius:8px;max-width:520px;max-height:90vh;overflow:auto;color:var(--primary-text)";
					box.innerHTML = `<h3 style="margin:0 0 12px">${I18n.admin?.editUser?.() ?? "Edit user"}</h3><p style="margin:0 0 12px;color:var(--text-muted)">Loading…</p>`;
					modal.appendChild(box);
					modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
					box.onclick = (e) => e.stopPropagation();
					document.body.appendChild(modal);

					fetch(api + `/_spacebar/admin/users/${userId}`, { headers: { Authorization: user!.token } })
						.then((r) => {
							if (!r.ok) return r.json().then((err: { message?: string }) => { throw new Error(err?.message ?? "HTTP " + r.status); });
							return r.json();
						})
						.then((data: Record<string, unknown>) => {
							const loadingP = box.querySelector("p");
							if (loadingP) loadingP.remove();
							const form = document.createElement("div");
							form.innerHTML = `
								<div style="margin-bottom:10px"><label>Username <input type="text" name="username" value="${escapeHtml(String(data.username ?? ""))}" style="width:100%;box-sizing:border-box"></label></div>
								<div style="margin-bottom:10px"><label>Discriminator <input type="text" name="discriminator" value="${escapeHtml(String(data.discriminator ?? ""))}" style="width:100%;box-sizing:border-box"></label></div>
								<div style="margin-bottom:10px"><label>Email <input type="email" name="email" value="${escapeHtml(String(data.email ?? ""))}" style="width:100%;box-sizing:border-box"></label></div>
								<div style="margin-bottom:10px"><label>Password (leave blank to keep) <input type="text" name="password" style="width:100%;box-sizing:border-box"> <button type="button" class="admin-btn admin-btn-random-pw">${I18n.admin?.generateRandom?.() ?? "Generate random"}</button></label></div>
								<div style="margin-bottom:10px"><label><input type="checkbox" name="disabled" ${(data.disabled as boolean) ? "checked" : ""}> Disabled</label></div>
								<div><strong>Rights</strong><input type="text" class="admin-rights-search" placeholder="Filter rights..." style="width:100%;box-sizing:border-box;padding:6px;margin-top:6px"><div class="admin-rights-container"></div></div>
							`;
							const rightsContainer = form.querySelector(".admin-rights-container") as HTMLElement;
							renderRightsCheckboxes(rightsContainer, String(data.rights ?? "0"));
							bindRightsSearch(rightsContainer, form.querySelector<HTMLInputElement>(".admin-rights-search"));
							form.querySelector(".admin-btn-random-pw")?.addEventListener("click", () => {
								const input = form.querySelector<HTMLInputElement>("input[name=password]");
								if (input) {
									input.value = randomPassword();
									input.type = "text";
									navigator.clipboard?.writeText(input.value).then(() => {}, () => {});
								}
							});
							box.appendChild(form);
							const buttons = document.createElement("div");
							buttons.style.marginTop = "16px";
							const saveBtn = document.createElement("button");
							saveBtn.className = "admin-btn";
							saveBtn.textContent = I18n.admin?.save?.() ?? "Save";
							const cancelBtn = document.createElement("button");
							cancelBtn.className = "admin-btn";
							cancelBtn.textContent = I18n.admin?.cancel?.() ?? "Cancel";
							cancelBtn.onclick = () => modal.remove();
							saveBtn.onclick = async () => {
								const username = form.querySelector<HTMLInputElement>("input[name=username]")?.value?.trim();
								const discriminator = form.querySelector<HTMLInputElement>("input[name=discriminator]")?.value?.trim();
								const email = form.querySelector<HTMLInputElement>("input[name=email]")?.value?.trim();
								const password = form.querySelector<HTMLInputElement>("input[name=password]")?.value?.trim();
								const disabled = (form.querySelector<HTMLInputElement>("input[name=disabled]")?.checked) ?? false;
								const rights = getRightsFromCheckboxes(form);
								const body: Record<string, unknown> = { username, discriminator, email, disabled, rights };
								if (password) body.password = password;
								try {
									const res = await fetch(api + `/_spacebar/admin/users/${userId}`, {
										method: "PATCH",
										headers,
										body: JSON.stringify(body),
									});
									if (!res.ok) {
										const j = await res.json().catch(() => ({}));
										alert(j.message ?? "Failed");
										return;
									}
									modal.remove();
									fetch(api + "/_spacebar/admin/users", { headers: { Authorization: user!.token } }).then((r) => r.json()).then(renderUsersTable);
								} catch (e) {
									alert("Error: " + (e as Error).message);
								}
							};
							buttons.append(saveBtn, " ", cancelBtn);
							box.appendChild(buttons);
						})
						.catch((e) => {
							const p = box.querySelector("p");
							if (p) p.textContent = "Error: " + (e as Error).message;
						});
				}

				createBtn.onclick = openCreateModal;

				fetch(api + "/_spacebar/admin/users", { headers: { Authorization: user!.token } })
					.then((r) => r.json())
					.then((arr: UserRow[]) => {
						if (Array.isArray(arr)) renderUsersTable(arr);
						else wrap.appendChild(document.createTextNode("Error: unexpected response"));
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

		const exitLink = document.createElement("a");
		exitLink.className = "admin-exit-link";
		exitLink.href = "/channels/@me";
		exitLink.textContent = I18n.admin?.exitAdmin?.() ?? "Exit admin";
		nav.appendChild(exitLink);

		root.appendChild(nav);
		root.appendChild(content);
		document.body.replaceChildren(root);

		(nav.querySelector(".admin-tab-btn") as HTMLButtonElement)?.click();
	})();
}
