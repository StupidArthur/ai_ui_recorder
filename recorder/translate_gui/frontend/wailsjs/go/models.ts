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
	    baseUrl: string;
	    apiKey: string;
	    model: string;

	    static createFrom(source: any = {}) {
	        return new AIConfig(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.baseUrl = source["baseUrl"];
	        this.apiKey = source["apiKey"];
	        this.model = source["model"];
	    }
	}
	export class ModelInfo {
	    name: string;
	    baseUrl: string;

	    static createFrom(source: any = {}) {
	        return new ModelInfo(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.baseUrl = source["baseUrl"];
	    }
	}

}
