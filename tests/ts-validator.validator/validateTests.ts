import * as chai from 'chai';
import * as types from 'ts-validator.core';
import { tsquery } from '@phenomnomnominal/tsquery';
import * as ts from 'typescript';
import { validate as validate, CompilerArgs } from '../../ts-validator.validator/src/validate';
import { convertType } from '../../ts-validator.code-gen/src/typeConvertor';

chai.should();

describe("validator", function () {
    function pad(text: string, pad: number) {
        var p = "";
        for (var i = 0; i < pad; i++) p += "  ";

        return text.split("\n").map(x => pad + "-" + p + x).join("\n");
    }

    function print(node: ts.Node, recurse = true, level = 0) {
        console.log(pad(ts.SyntaxKind[node.kind] + ": " + node.getFullText(), level));
        if (recurse) node.getChildren().map(x => print(x, recurse, level + 1));
    }

    function createFile(text: string) {
        return ts.createSourceFile(
            'testFile.ts', text, ts.ScriptTarget.ES2015, true, ts.ScriptKind.TS
        );
    }

    function resolveType(code: string, typeName: string, testSerializer = true) {
        const file = createFile(code + "\nvar t: " + typeName + ";");
        const variableTypes = tsquery<ts.TypeReferenceNode>(file, "VariableDeclaration TypeReference");
        if (!variableTypes.length) {
            print(file);
            throw new Error("Could not find variable.");
        }

        const type = convertType(variableTypes[variableTypes.length - 1], file, "testFile.ts");
        if (!type) {
            print(file);
            throw new Error("Could not resolve type.");
        }

        if (!(type instanceof types.AliasedType)) {
            print(file);
            console.error(type);
            throw new Error(`Error defining code. Expected TypeWithProperties or AliasedType`);
        }

        if (type.name !== typeName) {
            print(file);
            throw new Error(`Error defining code. Expected name: ${typeName}, actual name: ${type.name}`);
        }
        
        return type;
    }

    type OptionalCompilerArgs = {
        strictNullChecks?: boolean
    }

    function buildCompilerArgs(vals?: OptionalCompilerArgs): CompilerArgs {
        vals = vals || {};
        return {
            strictNullChecks: vals.strictNullChecks == null ? true : vals.strictNullChecks
        };
    }

    describe("Smoke test", () => {
        it("should validate type with no properties", () => {
            const t1 = resolveType("type T1 = {}", "T1");
            validate({}, t1, buildCompilerArgs()).length.should.be.eq(0);
        })
    });

    describe("property with keywords", () => {
        function execute (typeName: string, typeValue: any) {
            const t1 = resolveType(`type T1 = {x: ${typeName}}`, "T1");
            const t2 = resolveType(`type T2 = { y: { x: ${typeName}} }`, "T2");

            it(`should validate ${typeName} prop`, () => {
                validate({x: typeValue}, t1, buildCompilerArgs()).length.should.eq(0);
            });

            const notValue = typeName === "number" ? "not a number" : 7;
            it(`should invalidate non ${typeName} prop`, () => {
                validate({x: notValue}, t1, buildCompilerArgs()).length.should.not.eq(0);
            });

            it(`should validate ${typeName} inner prop`, () => {
                validate({y: {x: typeValue}}, t2, buildCompilerArgs()).length.should.eq(0);
            });

            it(`should invalidate non ${typeName} inner prop`, () => {
                validate({y: {x: notValue}}, t2, buildCompilerArgs()).length.should.not.eq(0);
            });
        }

        execute("string", "hello");
        execute("number", 4);
        execute("boolean", true);
        execute("null", null);
        execute("undefined", undefined);

        describe("any", () => {
            const t1 = resolveType(`type T1 = {x: any`, "T1");

            it(`should validate any prop`, () => {
                validate({x: 4}, t1, buildCompilerArgs()).length.should.eq(0);
                validate({x: null}, t1, buildCompilerArgs()).length.should.eq(0);
                validate({x: new Date()}, t1, buildCompilerArgs()).length.should.eq(0);
            });
        });

        describe("never", () => {
            const t1 = resolveType(`type T1 = {x: never`, "T1");

            it(`should invalidate never prop`, () => {
                validate({x: 4}, t1, buildCompilerArgs()).length.should.not.eq(0);
                validate({x: null}, t1, buildCompilerArgs()).length.should.not.eq(0);
                validate({x: new Date()}, t1, buildCompilerArgs()).length.should.not.eq(0);
            });
        });
    });

    describe("extends tests", () => {
        describe("single inheritance", () => {
            function execute (typeName: string, typeValue: any) {
                const t2 = resolveType(`interface T1 {x: ${typeName}}\r\ninterface T2 extends T1 { }`, "T2");

                it(`should validate ${typeName} prop`, () => {
                    validate({x: typeValue}, t2, buildCompilerArgs()).length.should.eq(0);
                });

                const notValue = typeName === "number" ? "not a number" : 7;
                it(`should invalidate non ${typeName} prop`, () => {
                    validate({x: notValue}, t2, buildCompilerArgs()).length.should.not.eq(0);
                });
            }

            execute("string", "hello");
            execute("number", 4);
        });
        
        describe("multiple inheritance, horizontal", () => {
            const t2 = resolveType(`interface T1 {x: string}\r\ninterface T2 {y: number}\r\ninterface T3 extends T1, T2 { }`, "T3");

            it(`should validate if both props ok`, () => {
                validate({x: "hi", y: 6}, t2, buildCompilerArgs()).length.should.eq(0);
            });

            it(`should not validate if one prop is bad`, () => {
                validate({x: "hi", y: "6"}, t2, buildCompilerArgs()).length.should.not.eq(0);
            });

            it(`should not validate if one other is bad`, () => {
                validate({y: 6}, t2, buildCompilerArgs()).length.should.not.eq(0);
            });
        });
        
        describe("multiple inheritance, vertical", () => {
            const t2 = resolveType(`interface T1 {x: string}\r\ninterface T2 extends T1 {y: number}\r\ninterface T3 extends T2 { }`, "T3");

            it(`should validate if both props ok`, () => {
                validate({x: "hi", y: 6}, t2, buildCompilerArgs()).length.should.eq(0);
            });

            it(`should not validate if one prop is bad`, () => {
                validate({x: "hi", y: "6"}, t2, buildCompilerArgs()).length.should.not.eq(0);
            });

            it(`should not validate if one other is bad`, () => {
                validate({y: 6}, t2, buildCompilerArgs()).length.should.not.eq(0);
            });
        });
    });

    describe("type alias tests", () => {
        function execute (typeName: string, typeValue: any) {
            const t2 = resolveType(`type T1 = {x: ${typeName}};\r\ntype T2 = T1;`, "T2");

            it(`should validate ${typeName} prop`, () => {
                validate({x: typeValue}, t2, buildCompilerArgs()).length.should.eq(0);
            });

            const notValue = typeName === "number" ? "not a number" : 7;
            it(`should invalidate non ${typeName} prop`, () => {
                validate({x: notValue}, t2, buildCompilerArgs()).length.should.not.eq(0);
            });
        }

        execute("string", "hello");
        execute("number", 4);
    });

    describe("array tests", () => {
        function execute (typeName: string, typeValue: any) {
            const t1 = resolveType(`type T1 = string[];`, "T1");

            it(`should validate correct array`, () => {
                validate(["hi"], t1, buildCompilerArgs()).length.should.eq(0);
            });

            it(`should validate empty array`, () => {
                validate([], t1, buildCompilerArgs()).length.should.eq(0);
            });

            it(`should not validate non array`, () => {
                validate("hi", t1, buildCompilerArgs()).length.should.not.eq(0);
            });

            it(`should not validate incorrect array`, () => {
                validate([4], t1, buildCompilerArgs()).length.should.not.eq(0);
            });
        }

        execute("string", "hello");
        execute("number", 4);
    });

    describe("strictNullChecks", () => {
        describe("input is null or undefined and no null checks", () => {
            const compilerArgs = buildCompilerArgs({strictNullChecks: false});
            const t1 = resolveType(`type T1 = {x: string}`, "T1");

            it(`should validate null input`, () => {
                validate(null, t1, compilerArgs).length.should.eq(0);
            });
            
            it(`should validate undefined input`, () => {
                validate(undefined, t1, compilerArgs).length.should.eq(0);
            });
        });
        
        describe("input is null or undefined and null checks", () => {
            const compilerArgs = buildCompilerArgs({strictNullChecks: true});
            const t1 = resolveType(`type T1 = {x: string}`, "T1");

            it(`should invalidate null input`, () => {
                validate(null, t1, compilerArgs).length.should.not.eq(0);
            });
            
            it(`should invalidate undefined input`, () => {
                validate(undefined, t1, compilerArgs).length.should.not.eq(0);
            });
        });

        describe("inner properties are null or undefined", () => {
            const compilerArgs = buildCompilerArgs({strictNullChecks: false});
            const t1 = resolveType(`type T1 = {x: string}`, "T1");

            it(`should validate string prop`, () => {
                validate({x: "hello"}, t1, compilerArgs).length.should.eq(0);
            });

            it(`should validate undefined prop`, () => {
                validate({x: undefined}, t1, compilerArgs).length.should.eq(0);
            });

            it(`should validate null prop`, () => {
                validate({x: null}, t1, compilerArgs).length.should.eq(0);
            });

            it(`should invalidate non string prop`, () => {
                validate({x: 5}, t1, compilerArgs).length.should.not.eq(0);
            });

            const t2 = resolveType(`type T2 = { y: { x: string} }`, "T2");
            it(`should validate string inner prop`, () => {
                validate({y: {x: "hello"}}, t2, compilerArgs).length.should.eq(0);
            });

            it(`should validate undefined inner prop`, () => {
                validate({y: {x: undefined}}, t2, compilerArgs).length.should.eq(0);
            });

            it(`should validate null inner prop`, () => {
                validate({y: {x: null}}, t2, compilerArgs).length.should.eq(0);
            });

            it(`should validate null outer prop`, () => {
                validate({y: null}, t2, compilerArgs).length.should.eq(0);
            });

            it(`should validate undefined outer prop`, () => {
                validate({y: undefined}, t2, compilerArgs).length.should.eq(0);
            });

            it(`should invalidate non string inner prop`, () => {
                validate({y: {x: 5}}, t2, compilerArgs).length.should.not.eq(0);
            });
        });
    });
    
    describe("recursive object tests", () => {

        it(`should not fail on recursive object`, () => {
            const t = resolveType(`type T1 = {x: T1 }`, "T1");
            const subject: any = {};
            subject.x = subject;

            validate(subject, t, buildCompilerArgs()).length.should.eq(0);
        });
    });
    
    describe("Error messages", () => {

        const t = resolveType(`type T1 = { x: { y: {"the z": string }[] } }`, "T1");
        it(`should not fail for control`, () => {
            validate({ x: { y: [{"the z": "hello" }] } }, t, buildCompilerArgs()).length.should.eq(0);
        });
        
        it(`format error correctly for complex name and array element`, () => {
            const errs = validate({ x: { y: [{"the z": "hello" }, {}] } }, t, buildCompilerArgs());
            errs.length.should.eq(1);
            errs[0].property.should.eq('$value.x.y[1]["the z"]');
        });
        
        it(`format error correctly for simpler element`, () => {
            const errs = validate({ x: { y: "hi" } }, t, buildCompilerArgs());
            errs.length.should.eq(1);
            errs[0].property.should.eq('$value.x.y');
        });
    });
    
    describe("validation behavior", () => {

        const t = resolveType(`type T1 = { x: string, y: number }`, "T1");
        it(`should not fail for control`, () => {
            validate({ x: "hi", y: 9 }, t, buildCompilerArgs()).length.should.eq(0);
        });
        
        it(`should continue validation after a failure`, () => {
            validate({ }, t, buildCompilerArgs()).length.should.eq(2);
        });
    });
});