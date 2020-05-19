import { fork } from 'child_process';
import * as async from 'promise-async';
import * as _ from 'lodash';
import 'ts-mocha';
import * as Mocha from 'mocha';

class ServerlessOfflineTest {
    commands: any;
    hooks: any;
    children: any[] = [];

    constructor(private serverless: any, private options: any) {
        this.commands = {
            "test": {
                usage: "Runs Offline tests",
                lifecycleEvents: [
                    "start",
                    "end"
                ],
                commands: {
                    start: {
                        lifecycleEvents: [
                            "init",
                            "start",
                            "end"
                        ],
                    },
                    options: {
                        debug: {
                            usage: "Log output from child processes"
                        }
                    }
                },
            },
        };
        this.hooks = {
            "test:start:init": () => {
                return this.run();
            },
            "before:offline:start:init": () => {
                process.send && process.send("DEPENDENCY:READY")
            },
        };
    }

    get config() {
        return this.serverless.service.custom["serverless-offline-test"]
    }

    async run() {
        process.on("exit", () => this.stop())
        this.log("Starting Dependencies")
        const dependencies = this.config.dependencies;

        await async.waterfall([
           (next) => {
                async.eachSeries(dependencies.filter(dep => dep.blocking), this.startDependency.bind(this)).then(next)
           },
           (next) => {
               async.each(dependencies.filter(dep => !dep.blocking), this.startDependency.bind(this)).then(next)
           }
        ]) 
        
        setTimeout(() => this.runTests(), 500)
    }

    startDependency(dep, next) {
        this.log(`Starting ${dep.name}`)
        const child = fork(`${dep.run}`, dep.args, {silent: true, cwd: dep.cwd})
    
        if(this.config.debug || this.options.debug) {
            child.stderr.pipe(process.stderr);
            child.stdout.pipe(process.stdout);
        }
        const listener = (msg) => {
            if(msg === "DEPENDENCY:READY") {
                child.off("message", listener)
                setTimeout(() => {
                    next()
                }, 100)
            };
        }
        child.on("message", listener)
        this.children.push(child)
        
    }

    runTests() {
        const tests =  this.serverless.service.custom["serverless-offline-test"].tests
        const mocha = new Mocha();
        _.forEach(tests, (file) => mocha.addFile(file))

        mocha.run((failures) => {
            this.stop(failures);
        });
    }

    public log(msg, prefix = "INFO[serverless-offline-test]: ") {
        if(msg instanceof Object) {
            msg = JSON.stringify(msg)
        }
        this.serverless.cli.log.call(this.serverless.cli, prefix + msg);
    }

    public stop(failures?) {
        this.children.forEach(child => child.kill())
        process.exit(failures)
    }

}

module.exports = ServerlessOfflineTest;