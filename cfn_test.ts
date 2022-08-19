// TODO import_maps
import { assertEquals } from "https://deno.land/std@0.152.0/testing/asserts.ts";

import { parse } from "./cfn.ts";

Deno.test("test minimum statemachine", () => {
  const yaml = `
AWSTemplateFormatVersion: "2010-09-09"
Transform: AWS::Serverless-2016-10-31
Description: Test

Resources:
  StateMachine:
    Type: AWS::Serverless::StateMachine
    Properties:
      DefinitionUri: test.asl.json
  `;
  const result = parse(yaml);
  assertEquals(result, {
    Resources: {
      StateMachine: {
        Type: "AWS::Serverless::StateMachine",
        Properties: {
          DefinitionUri: "test.asl.json",
        },
      },
    },
  });
});

Deno.test("test statemachine", () => {
  const yaml = `
AWSTemplateFormatVersion: "2010-09-09"
Transform: AWS::Serverless-2016-10-31
Description: Test

Resources:
  StateMachine:
    Type: AWS::Serverless::StateMachine
    Properties:
      DefinitionUri: test.asl.json
      DefinitionSubstitutions:
        Foo: !GetAtt Bar.Arn
        Baz: x
  `;
  const result = parse(yaml);
  assertEquals(result, {
    Resources: {
      StateMachine: {
        Type: "AWS::Serverless::StateMachine",
        Properties: {
          DefinitionUri: "test.asl.json",
          DefinitionSubstitutions: {
            Foo: {
              "Fn::GetAtt": [
                "Bar",
                "Arn",
              ],
            },
            Baz: "x",
          },
        },
      },
    },
  });
});

Deno.test("test function", () => {
  const yaml = `
AWSTemplateFormatVersion: "2010-09-09"
Transform: AWS::Serverless-2016-10-31
Description: Test

Resources:
  Lambda:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: .
      Handler: main.go
      Runtime: go1.x
      Architectures:
        - x86_64
  `;
  const result = parse(yaml);
  assertEquals(result, {
    Resources: {
      Lambda: {
        Type: "AWS::Serverless::Function",
      },
    },
  });
});

Deno.test("test not interested.", () => {
  const yaml = `
AWSTemplateFormatVersion: "2010-09-09"
Transform: AWS::Serverless-2016-10-31
Description: Test

Resources:
  Lambda:
    Type: AWS::Serverless::Functionx
    Properties:
      CodeUri: .
      Handler: main.go
      Runtime: go1.x
      Architectures:
        - x86_64
  `;
  const result = parse(yaml);
  assertEquals(result, {
    Resources: {},
  });
});
