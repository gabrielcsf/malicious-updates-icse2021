# Containing Malicious Package Updates in npm with a Lightweight Permission System.

This repository contains the implementation artifacts and evaluation benchmarks described in our ICSE paper: [Containing Malicious Package Updates in npm with a Lightweight Permission System](https://www.computer.org/csdl/proceedings-article/icse/2021/029600b334/1sEXpl8jerS)

Link to the paper arXiv version: https://arxiv.org/abs/2103.05769

* * *
## Implementation

In the root of this repository, you can find two source code directories: **(i) permsystem**, the JavaScript project that implements the permission system mechanisms and **(ii) node-engine-with-permsystem**, a modified version of the Node.js engine with the permission system as part of the code.

### Permission System:  `permsystem` project

To build the project, just run the following command in your terminal:
```
npm install
```


To run unit tests, just run the following command in your terminal:
```
npm test
```

To run mutation tests, just run the following command in your terminal:
```
npx stryker run
```
You should have [stryker](https://www.npmjs.com/package/stryker) installed in order for this command to work.

### Node.js engine: `node-engine-with-permsystem` project

To build the project, just follow the original instructions in the README file of the project.

* * *
## Evaluation benchmarks

To build the project, just run the following command in your terminal:
```
npm install
```

After that, you may execute the scripts following the ordered numbers in their names.
