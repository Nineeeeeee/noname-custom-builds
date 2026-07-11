import { get, lib } from "noname";

export const type = "extension";

export default function (): importExtensionConfig {
	return {
		name: "my-wudi",
		editable: false,
		connect: false,
		precontent: function () {
			if (!lib.group.includes("re")) {
				lib.group.add("re");
			}

			lib.translate.re = "热";
			lib.translate.re2 = "热势力";
			lib.translate.reColor = "#ff7043";
			lib.translate.group_re = "热势力";
			lib.translate.group_re_bg = "热";
			(lib.groupnature as Record<string, string>).re = "fire";
		},
		content: function () {},
		config: {},
		help: {},
		package: {
			character: {
				character: {
					wo_wudi: ["male", "re", 4, ["tanlan"], ["ext:my-wudi/image/character/wo_wudi.png"]],
				},
				translate: {
					wo_wudi: "我无敌",
				},
			},
			card: {
				card: {},
				translate: {},
				list: [],
			},
			skill: {
				skill: {
					tanlan: {
						audio: "ext:my-wudi/audio/skill:true",
						trigger: { player: ["phaseZhunbeiBegin", "phaseJieshuBegin"] },
						async cost(event, trigger, player) {
							event.result = await player.chooseBool(get.prompt2(event.skill)).forResult();
						},
						async content(event, trigger, player) {
							await player.draw(2);
						},
					},
				},
				translate: {
					tanlan: "贪婪",
					tanlan_info: "准备阶段开始时和结束阶段开始时，你可以摸两张牌。",
				},
			},
			intro: "专属 DIY 武将：我无敌。",
			author: "fengxuwen",
			diskURL: "",
			forumURL: "",
			version: "1.0",
		},
		files: {
			character: ["image/character/wo_wudi.png"],
			card: [],
			skill: [],
			audio: ["audio/skill/tanlan.mp3"],
		},
	};
}
