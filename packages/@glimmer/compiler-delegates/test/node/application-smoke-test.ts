import Application, { BytecodeLoader, BytecodeData, SyncRenderer } from '@glimmer/application';
import { StringBuilder } from '@glimmer/ssr';
import { BundleCompiler } from '@glimmer/bundle-compiler';
import { module, test} from 'qunitjs';
import { MUCompilerDelegate } from '@glimmer/compiler-delegates';
import { sync as findup } from 'find-up';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import babel from 'babel-core';
import transformCJS from 'babel-plugin-transform-es2015-modules-commonjs';
import * as SimpleDOM from 'simple-dom';
import Resolver, { BasicModuleRegistry } from '@glimmer/resolver';
import { ComponentManager } from '@glimmer/component';
import rollup from 'rollup';
import virtual from 'rollup-plugin-virtual';

let compiler;
let tmp = os.tmpdir();
let bytecode;
module('Application smoke tests', {
  async beforeEach() {
    let projectPath = findup('packages/@glimmer/compiler-delegates/test/node/fixtures/mu');

    let delegate = new MUCompilerDelegate({
      projectPath,
      mainTemplateLocator: { module: './src/ui/components/My-Main/template.hbs', name: 'default' },
      outputFiles: {
        dataSegment: 'data.js',
        heapFile: 'templates.gbx'
      }
    });

    compiler = new BundleCompiler(delegate);
    compiler.add({ module: './src/ui/components/My-Main/template.hbs', name: 'default' }, fs.readFileSync(path.join(projectPath, 'src/ui/components/My-Main/template.hbs')).toString());
    compiler.add({ module: './src/ui/components/User/template.hbs', name: 'default' }, fs.readFileSync(path.join(projectPath, 'src/ui/components/User/template.hbs')).toString());
    let result = compiler.compile();
    let code = delegate.generateDataSegment(result);

    fs.writeFileSync(path.join(tmp, 'smoke-data.js'), code);

    const bundle = await rollup.rollup({
      entry: path.join(tmp, 'smoke-data.js'),
      plugins: [
        virtual({
          '@glimmer/application': 'export const ifHelper = () => { return "STUB" };'
        })
      ]
    });

    let rolledUp = await bundle.generate({ format: 'es' });

    let transformed = babel.transform(rolledUp.code, {
      plugins: [transformCJS]
    });

    fs.writeFileSync(path.join(tmp, 'smoke-data.js'), transformed.code);
    QUnit.assert.ok(transformed.code, `Generated data as ${transformed.code}`);
    console.log(`Generated data as: ${transformed.code}`)
    bytecode = result.heap.buffer;
    QUnit.assert.ok(bytecode, `Generated bytecode`);
    console.log(`Generated bytecode as: `, bytecode);
  }
});

let defaultResolverMap = {
  app: {
    name: 'smoke',
    rootName: 'smoke'
  },
  types: {
    application: { definitiveCollection: 'main' },
    component: { definitiveCollection: 'components' },
    helper: { definitiveCollection: 'components' },
    renderer: { definitiveCollection: 'main' },
    template: { definitiveCollection: 'components' },
    util: { definitiveCollection: 'utils' },
    'component-manager': { definitiveCollection: 'component-managers' }
  },
  collections: {
    main: {
      types: ['application', 'renderer']
    },
    components: {
      group: 'ui',
      types: ['component', 'template', 'helper'],
      defaultType: 'component'
    },
    'component-managers': {
      types: ['component-manager']
    },
    utils: {
      unresolvable: true
    }
  }
};

test('Boots and renders an app', async function(assert) {
  let data = require(path.join(tmp, 'smoke-data.js')).default as BytecodeData;
  assert.ok(data, 'Loaded data')
  let loader = new BytecodeLoader({ bytecode, data });
  let doc = new SimpleDOM.Document();
  let builder = new StringBuilder({ element: doc.body, nextSibling: null });
  let renderer = new SyncRenderer();
  let serializer = new SimpleDOM.HTMLSerializer(SimpleDOM.voidMap);
  let registry = new BasicModuleRegistry();
  let resolver = new Resolver(defaultResolverMap, registry);

  let app = new Application({
    rootName: 'app',
    loader,
    document: doc,
    builder,
    renderer,
    resolver
  });

  app.registerInitializer({
    initialize(registry) {
      registry.register(`component-manager:/${app.rootName}/component-managers/main`, ComponentManager);
    }
  });


  await app.boot();

  console.log('Rendered as: ' + serializer.serializeChildren(doc.body).trim());
  assert.equal(serializer.serializeChildren(doc.body).trim(), '<div class="user">Chad STUB</div>');
});
