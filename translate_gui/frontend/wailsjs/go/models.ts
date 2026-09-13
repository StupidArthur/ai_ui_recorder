export namespace domain {

	export class PromptInfo {
	    phase: string;
	    name: string;
	    content: string;
	    isCustom: boolean;

	    static createFrom(source: any = {}) {
	        return new PromptInfo(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.phase = source["phase"];
	        this.name = source["name"];
	        this.content = source["content"];
	        this.isCustom = source["isCustom"];
	    }
	}
	export class RunInfo {
	    dirName: string;
	    fullPath: string;
	    title: string;
	    startedAt: string;
	    actionCount: number;
	    translated: boolean;

	    static createFrom(source: any = {}) {
	        return new RunInfo(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.dirName = source["dirName"];
	        this.fullPath = source["fullPath"];
	        this.title = source["title"];
	        this.startedAt = source["startedAt"];
	        this.actionCount = source["actionCount"];
	        this.translated = source["translated"];
	    }
	}
	export class SaveResult {
	    success: boolean;
	    message: string;
	    path: string;

	    static createFrom(source: any = {}) {
	        return new SaveResult(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.success = source["success"];
	        this.message = source["message"];
	        this.path = source["path"];
	    }
	}
	export class TestResult {
	    success: boolean;
	    message: string;
	    reply: string;

	    static createFrom(source: any = {}) {
	        return new TestResult(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.success = source["success"];
	        this.message = source["message"];
	        this.reply = source["reply"];
	    }
	}
	export class TranslateProgress {
	    phase: string;
	    step: string;
	    detail: string;
	    percent: number;

	    static createFrom(source: any = {}) {
	        return new TranslateProgress(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.phase = source["phase"];
	        this.step = source["step"];
	        this.detail = source["detail"];
	        this.percent = source["percent"];
	    }
	}
	export class TranslateResult {
	    success: boolean;
	    message: string;
	    runDir: string;

	    static createFrom(source: any = {}) {
	        return new TranslateResult(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.success = source["success"];
	        this.message = source["message"];
	        this.runDir = source["runDir"];
	    }
	}

}

export namespace llm {

	export class AIConfig {
	    name?: string;
	    protocol: string;
	    baseUrl: string;
	    apiKey: string;
	    model: string;
	    reasoningEffort?: string;

	    static createFrom(source: any = {}) {
	        return new AIConfig(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.protocol = source["protocol"];
	        this.baseUrl = source["baseUrl"];
	        this.apiKey = source["apiKey"];
	        this.model = source["model"];
	        this.reasoningEffort = source["reasoningEffort"];
	    }
	}
	export class ConfigProfileInfo {
	    name: string;
	    protocol: string;
	    baseUrl: string;
	    model: string;
	    reasoningEffort: string;
	    hasKey: boolean;

	    static createFrom(source: any = {}) {
	        return new ConfigProfileInfo(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.protocol = source["protocol"];
	        this.baseUrl = source["baseUrl"];
	        this.model = source["model"];
	        this.reasoningEffort = source["reasoningEffort"];
	        this.hasKey = source["hasKey"];
	    }
	}
	export class ConfigProfiles {
	    active: string;
	    profiles: ConfigProfileInfo[];

	    static createFrom(source: any = {}) {
	        return new ConfigProfiles(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.active = source["active"];
	        this.profiles = this.convertValues(source["profiles"], ConfigProfileInfo);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}
