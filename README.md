# sam-local-asl

WORK IN PROGRESS.

Generator for Amazon States Language for Local test.

## Example

```bash
$ cat example/template.yml
AWSTemplateFormatVersion: "2010-09-09"
Transform: AWS::Serverless-2016-10-31
Description: Example template.

Resources:
  MyStateMachine:
    Type: AWS::Serverless::StateMachine
    Properties:
      DefinitionUri: example.asl.json
      DefinitionSubstitutions:
        MyFunction: !GetAtt MyFunction.Arn

  MyFunction:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: where/to/code
      Handler: main.go
      Runtime: go1.x
      Architectures:
        - x86_64

# TODO template.yml and example.asl.json not tested.
$ cat example/example.asl.json
{
  "Comment": "Example State Machine",
  "StartAt": "Run",
  "States": {
    "Run": {
      "Type": "Task",
      "Resource": "${MyFunction}",
      "End": true
    }
  }
}
$ deno run --allow-read ./main.ts example/template.yml
{
  "Comment": "Example State Machine",
  "StartAt": "Run",
  "States": {
    "Run": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:us-east-1:123456789012:function:MyFunction",
      "End": true
    }
  }
}
$
```

## License

[MIT](LICENSE)

## Author

[yskszk63](https://github.com/yskszk63)
