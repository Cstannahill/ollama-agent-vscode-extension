import { BaseTool } from "../core/BaseTool";
import { z } from "zod";
import { logger } from "../utils/logger";
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs/promises";

// Component Generator Tool
export class ComponentGeneratorTool extends BaseTool {
  name = "generate_component";
  description = "Generate code components like React components, classes, interfaces, etc.";
  
  schema = z.object({
    type: z.enum(["react-component", "react-hook", "typescript-class", "typescript-interface", "express-route", "vue-component"]).describe("Type of component to generate"),
    name: z.string().describe("Name of the component"),
    directory: z.string().optional().describe("Directory to create the component in (relative to workspace)"),
    props: z.array(z.string()).optional().describe("Component props or class properties"),
    methods: z.array(z.string()).optional().describe("Component methods or class methods"),
    styled: z.boolean().optional().describe("Include styled components/CSS (for React/Vue)"),
    tests: z.boolean().optional().describe("Generate test files"),
  });

  async execute(params: z.infer<typeof this.schema>): Promise<string> {
    try {
      const { type, name, directory = "src", props = [], methods = [], styled = false, tests = false } = params;
      
      logger.info(`[COMPONENT_GENERATOR] Generating ${type}: ${name}`);

      const workspacePath = this.getWorkspaceRoot();
      const targetDir = path.resolve(workspacePath, directory);
      
      // Ensure directory exists
      await fs.mkdir(targetDir, { recursive: true });

      const generatedFiles = await this.generateComponent({
        type,
        name,
        targetDir,
        props,
        methods,
        styled,
        tests
      });

      logger.info(`[COMPONENT_GENERATOR] Generated ${generatedFiles.length} files`);
      
      return `Generated ${type} '${name}' successfully:\n\n` +
        generatedFiles.map(file => `• ${file}`).join('\n');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("[COMPONENT_GENERATOR] Failed:", error);
      throw new Error(`Component generation failed: ${errorMessage}`);
    }
  }

  private async generateComponent(params: {
    type: string;
    name: string;
    targetDir: string;
    props: string[];
    methods: string[];
    styled: boolean;
    tests: boolean;
  }): Promise<string[]> {
    const { type, name, targetDir, props, methods, styled, tests } = params;
    const generatedFiles: string[] = [];

    switch (type) {
      case "react-component":
        generatedFiles.push(...await this.generateReactComponent(name, targetDir, props, methods, styled, tests));
        break;
      case "react-hook":
        generatedFiles.push(...await this.generateReactHook(name, targetDir, tests));
        break;
      case "typescript-class":
        generatedFiles.push(...await this.generateTypeScriptClass(name, targetDir, props, methods, tests));
        break;
      case "typescript-interface":
        generatedFiles.push(...await this.generateTypeScriptInterface(name, targetDir, props));
        break;
      case "express-route":
        generatedFiles.push(...await this.generateExpressRoute(name, targetDir, methods, tests));
        break;
      case "vue-component":
        generatedFiles.push(...await this.generateVueComponent(name, targetDir, props, methods, styled, tests));
        break;
      default:
        throw new Error(`Unsupported component type: ${type}`);
    }

    return generatedFiles;
  }

  private async generateReactComponent(
    name: string, 
    targetDir: string, 
    props: string[], 
    methods: string[], 
    styled: boolean, 
    tests: boolean
  ): Promise<string[]> {
    const files: string[] = [];
    const componentDir = path.join(targetDir, name);
    await fs.mkdir(componentDir, { recursive: true });

    // Main component file
    const propsInterface = props.length > 0 ? `interface ${name}Props {\n  ${props.join(';\n  ')};\n}\n\n` : '';
    const propsParam = props.length > 0 ? `props: ${name}Props` : '';
    const methodsCode = methods.length > 0 ? 
      methods.map(method => `  const ${method} = () => {\n    // TODO: Implement ${method}\n  };`).join('\n\n') + '\n\n' : '';

    const componentContent = `import React from 'react';
${styled ? `import styled from 'styled-components';\n` : ''}
${propsInterface}${styled ? `const StyledContainer = styled.div\`
  /* Add your styles here */
\`;\n\n` : ''}const ${name}: React.FC${props.length > 0 ? `<${name}Props>` : ''} = (${propsParam}) => {
${methodsCode}  return (
    ${styled ? `<StyledContainer>` : '<div>'}
      <h1>${name} Component</h1>
      {/* Add your component content here */}
    ${styled ? `</StyledContainer>` : '</div>'}
  );
};

export default ${name};`;

    const componentFile = path.join(componentDir, `${name}.tsx`);
    await fs.writeFile(componentFile, componentContent);
    files.push(componentFile);

    // Index file
    const indexContent = `export { default } from './${name}';\nexport type { ${name}Props } from './${name}';`;
    const indexFile = path.join(componentDir, 'index.ts');
    await fs.writeFile(indexFile, indexContent);
    files.push(indexFile);

    // Test file
    if (tests) {
      const testContent = `import React from 'react';
import { render, screen } from '@testing-library/react';
import ${name} from './${name}';

describe('${name}', () => {
  it('renders without crashing', () => {
    render(<${name} />);
    expect(screen.getByText('${name} Component')).toBeInTheDocument();
  });

  // Add more tests here
});`;

      const testFile = path.join(componentDir, `${name}.test.tsx`);
      await fs.writeFile(testFile, testContent);
      files.push(testFile);
    }

    return files;
  }

  private async generateReactHook(name: string, targetDir: string, tests: boolean): Promise<string[]> {
    const files: string[] = [];
    const hookName = name.startsWith('use') ? name : `use${name}`;

    const hookContent = `import { useState, useEffect } from 'react';

interface ${hookName.charAt(0).toUpperCase() + hookName.slice(1)}State {
  // Define your hook state interface here
  data: any;
  loading: boolean;
  error: string | null;
}

const ${hookName} = () => {
  const [state, setState] = useState<${hookName.charAt(0).toUpperCase() + hookName.slice(1)}State>({
    data: null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    // Add your hook logic here
  }, []);

  return {
    ...state,
    // Add your hook methods here
  };
};

export default ${hookName};`;

    const hookFile = path.join(targetDir, `${hookName}.ts`);
    await fs.writeFile(hookFile, hookContent);
    files.push(hookFile);

    if (tests) {
      const testContent = `import { renderHook } from '@testing-library/react';
import ${hookName} from './${hookName}';

describe('${hookName}', () => {
  it('should initialize with default state', () => {
    const { result } = renderHook(() => ${hookName}());
    
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  // Add more tests here
});`;

      const testFile = path.join(targetDir, `${hookName}.test.ts`);
      await fs.writeFile(testFile, testContent);
      files.push(testFile);
    }

    return files;
  }

  private async generateTypeScriptClass(
    name: string, 
    targetDir: string, 
    props: string[], 
    methods: string[], 
    tests: boolean
  ): Promise<string[]> {
    const files: string[] = [];

    const propertiesCode = props.length > 0 ? 
      props.map(prop => `  private ${prop};`).join('\n') + '\n\n' : '';
    
    const constructorParams = props.length > 0 ? 
      props.map(prop => prop.split(':')[0].trim()).join(', ') : '';
    
    const constructorAssignments = props.length > 0 ? 
      props.map(prop => {
        const propName = prop.split(':')[0].trim();
        return `    this.${propName} = ${propName};`;
      }).join('\n') : '';

    const methodsCode = methods.length > 0 ? 
      methods.map(method => {
        const methodName = method.split('(')[0].trim();
        return `  public ${method} {\n    // TODO: Implement ${methodName}\n  }`;
      }).join('\n\n') + '\n' : '';

    const classContent = `/**
 * ${name} class
 */
export class ${name} {
${propertiesCode}  constructor(${constructorParams}) {
${constructorAssignments}
  }

${methodsCode}}`;

    const classFile = path.join(targetDir, `${name}.ts`);
    await fs.writeFile(classFile, classContent);
    files.push(classFile);

    if (tests) {
      const testContent = `import { ${name} } from './${name}';

describe('${name}', () => {
  it('should create an instance', () => {
    const instance = new ${name}(${constructorParams});
    expect(instance).toBeInstanceOf(${name});
  });

  // Add more tests here
});`;

      const testFile = path.join(targetDir, `${name}.test.ts`);
      await fs.writeFile(testFile, testContent);
      files.push(testFile);
    }

    return files;
  }

  private async generateTypeScriptInterface(name: string, targetDir: string, props: string[]): Promise<string[]> {
    const files: string[] = [];

    const interfaceContent = `/**
 * ${name} interface
 */
export interface ${name} {
${props.length > 0 ? '  ' + props.join(';\n  ') + ';' : '  // Add interface properties here'}
}`;

    const interfaceFile = path.join(targetDir, `${name}.ts`);
    await fs.writeFile(interfaceFile, interfaceContent);
    files.push(interfaceFile);

    return files;
  }

  private async generateExpressRoute(name: string, targetDir: string, methods: string[], tests: boolean): Promise<string[]> {
    const files: string[] = [];
    const routeName = name.toLowerCase();

    const routeMethods = methods.length > 0 ? methods : ['get', 'post', 'put', 'delete'];
    
    const routeHandlers = routeMethods.map(method => {
      const methodName = method.toLowerCase();
      return `// ${methodName.toUpperCase()} /${routeName}
router.${methodName}('/', async (req: Request, res: Response) => {
  try {
    // TODO: Implement ${methodName} ${routeName}
    res.json({ message: '${methodName.toUpperCase()} ${routeName} endpoint' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});`;
    }).join('\n\n');

    const routeContent = `import { Router, Request, Response } from 'express';

const router = Router();

${routeHandlers}

export default router;`;

    const routeFile = path.join(targetDir, `${routeName}.routes.ts`);
    await fs.writeFile(routeFile, routeContent);
    files.push(routeFile);

    if (tests) {
      const testContent = `import request from 'supertest';
import express from 'express';
import ${routeName}Routes from './${routeName}.routes';

const app = express();
app.use('/${routeName}', ${routeName}Routes);

describe('${name} Routes', () => {
  it('should respond to GET /${routeName}', async () => {
    const response = await request(app)
      .get('/${routeName}')
      .expect(200);
    
    expect(response.body).toHaveProperty('message');
  });

  // Add more route tests here
});`;

      const testFile = path.join(targetDir, `${routeName}.routes.test.ts`);
      await fs.writeFile(testFile, testContent);
      files.push(testFile);
    }

    return files;
  }

  private async generateVueComponent(
    name: string, 
    targetDir: string, 
    props: string[], 
    methods: string[], 
    styled: boolean, 
    tests: boolean
  ): Promise<string[]> {
    const files: string[] = [];

    const propsDefinition = props.length > 0 ? 
      `const props = defineProps<{\n  ${props.join('\n  ')}\n}>();\n\n` : '';
    
    const methodsDefinition = methods.length > 0 ? 
      methods.map(method => `const ${method} = () => {\n  // TODO: Implement ${method}\n};`).join('\n\n') + '\n\n' : '';

    const componentContent = `<template>
  <div${styled ? ' class="container"' : ''}>
    <h1>${name} Component</h1>
    <!-- Add your template here -->
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

${propsDefinition}${methodsDefinition}</script>

${styled ? `<style scoped>
.container {
  /* Add your styles here */
}
</style>` : ''}`;

    const componentFile = path.join(targetDir, `${name}.vue`);
    await fs.writeFile(componentFile, componentContent);
    files.push(componentFile);

    if (tests) {
      const testContent = `import { mount } from '@vue/test-utils';
import ${name} from './${name}.vue';

describe('${name}', () => {
  it('renders properly', () => {
    const wrapper = mount(${name}, {
      props: {}
    });
    
    expect(wrapper.text()).toContain('${name} Component');
  });

  // Add more tests here
});`;

      const testFile = path.join(targetDir, `${name}.test.ts`);
      await fs.writeFile(testFile, testContent);
      files.push(testFile);
    }

    return files;
  }
}

// Project Scaffolding Tool
export class ProjectScaffoldTool extends BaseTool {
  name = "scaffold_project";
  description = "Generate complete project structures and boilerplate code";
  
  schema = z.object({
    type: z.enum(["node-api", "react-app", "vue-app", "typescript-lib", "express-server", "next-app"]).describe("Type of project to scaffold"),
    name: z.string().describe("Project name"),
    directory: z.string().optional().describe("Directory to create project in (default: project name)"),
    features: z.array(z.string()).optional().describe("Additional features to include"),
    packageManager: z.enum(["npm", "yarn", "pnpm"]).optional().describe("Package manager preference"),
  });

  async execute(params: z.infer<typeof this.schema>): Promise<string> {
    try {
      const { type, name, directory = name, features = [], packageManager = "npm" } = params;
      
      logger.info(`[PROJECT_SCAFFOLD] Scaffolding ${type} project: ${name}`);

      const workspacePath = this.getWorkspaceRoot();
      const projectDir = path.resolve(workspacePath, directory);
      
      // Ensure project directory exists
      await fs.mkdir(projectDir, { recursive: true });

      const generatedFiles = await this.scaffoldProject({
        type,
        name,
        projectDir,
        features,
        packageManager
      });

      logger.info(`[PROJECT_SCAFFOLD] Generated ${generatedFiles.length} files`);
      
      return `Scaffolded ${type} project '${name}' successfully:\n\n` +
        generatedFiles.map(file => `• ${file}`).join('\n') +
        `\n\nNext steps:\n• cd ${directory}\n• ${packageManager} install\n• ${packageManager} run dev`;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("[PROJECT_SCAFFOLD] Failed:", error);
      throw new Error(`Project scaffolding failed: ${errorMessage}`);
    }
  }

  private async scaffoldProject(params: {
    type: string;
    name: string;
    projectDir: string;
    features: string[];
    packageManager: string;
  }): Promise<string[]> {
    const { type, name, projectDir, features, packageManager } = params;
    const generatedFiles: string[] = [];

    // Generate package.json
    const packageJson = this.generatePackageJson(type, name, features, packageManager);
    const packageJsonFile = path.join(projectDir, 'package.json');
    await fs.writeFile(packageJsonFile, JSON.stringify(packageJson, null, 2));
    generatedFiles.push(packageJsonFile);

    // Generate README.md
    const readmeContent = this.generateReadme(type, name, packageManager);
    const readmeFile = path.join(projectDir, 'README.md');
    await fs.writeFile(readmeFile, readmeContent);
    generatedFiles.push(readmeFile);

    // Generate .gitignore
    const gitignoreContent = this.generateGitignore(type);
    const gitignoreFile = path.join(projectDir, '.gitignore');
    await fs.writeFile(gitignoreFile, gitignoreContent);
    generatedFiles.push(gitignoreFile);

    // Type-specific scaffolding
    switch (type) {
      case "node-api":
        generatedFiles.push(...await this.scaffoldNodeApi(projectDir, features));
        break;
      case "react-app":
        generatedFiles.push(...await this.scaffoldReactApp(projectDir, features));
        break;
      case "express-server":
        generatedFiles.push(...await this.scaffoldExpressServer(projectDir, features));
        break;
      // Add more scaffolding types as needed
    }

    return generatedFiles;
  }

  private generatePackageJson(type: string, name: string, features: string[], packageManager: string): any {
    const basePackage = {
      name: name.toLowerCase().replace(/\s+/g, '-'),
      version: "1.0.0",
      description: `A ${type} project`,
      main: "index.js",
      scripts: {},
      dependencies: {},
      devDependencies: {}
    };

    switch (type) {
      case "node-api":
      case "express-server":
        basePackage.scripts = {
          start: "node dist/index.js",
          dev: "ts-node-dev src/index.ts",
          build: "tsc",
          test: "jest"
        };
        basePackage.dependencies = {
          express: "^4.18.0",
          cors: "^2.8.5",
          helmet: "^6.0.0"
        };
        basePackage.devDependencies = {
          "@types/express": "^4.17.0",
          "@types/node": "^18.0.0",
          "ts-node-dev": "^2.0.0",
          typescript: "^4.9.0",
          jest: "^29.0.0"
        };
        break;
        
      case "react-app":
        basePackage.scripts = {
          start: "react-scripts start",
          build: "react-scripts build",
          test: "react-scripts test",
          eject: "react-scripts eject"
        };
        basePackage.dependencies = {
          react: "^18.0.0",
          "react-dom": "^18.0.0",
          "react-scripts": "5.0.1"
        };
        basePackage.devDependencies = {
          "@types/react": "^18.0.0",
          "@types/react-dom": "^18.0.0",
          typescript: "^4.9.0"
        };
        break;
    }

    return basePackage;
  }

  private generateReadme(type: string, name: string, packageManager: string): string {
    return `# ${name}

A ${type} project generated with automated scaffolding.

## Getting Started

1. Install dependencies:
   \`\`\`bash
   ${packageManager} install
   \`\`\`

2. Start development server:
   \`\`\`bash
   ${packageManager} run dev
   \`\`\`

3. Build for production:
   \`\`\`bash
   ${packageManager} run build
   \`\`\`

## Scripts

- \`${packageManager} run dev\` - Start development server
- \`${packageManager} run build\` - Build for production
- \`${packageManager} run test\` - Run tests

## Project Structure

\`\`\`
${name}/
├── src/
│   └── index.ts
├── package.json
├── tsconfig.json
└── README.md
\`\`\`

## License

MIT
`;
  }

  private generateGitignore(type: string): string {
    const common = `# Dependencies
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Environment variables
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# Build outputs
dist/
build/

# IDE
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db`;

    switch (type) {
      case "react-app":
        return common + `

# React specific
# production build`;
      default:
        return common;
    }
  }

  private async scaffoldNodeApi(projectDir: string, features: string[]): Promise<string[]> {
    const files: string[] = [];
    
    // Create src directory
    const srcDir = path.join(projectDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });

    // Main index.ts
    const indexContent = `import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Routes
app.get('/', (req, res) => {
  res.json({ message: 'API is running!' });
});

app.listen(PORT, () => {
  console.log(\`Server running on port \${PORT}\`);
});`;

    const indexFile = path.join(srcDir, 'index.ts');
    await fs.writeFile(indexFile, indexContent);
    files.push(indexFile);

    // TypeScript config
    const tsconfigContent = {
      compilerOptions: {
        target: "ES2020",
        module: "commonjs",
        outDir: "./dist",
        rootDir: "./src",
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true
      },
      include: ["src/**/*"],
      exclude: ["node_modules", "dist"]
    };

    const tsconfigFile = path.join(projectDir, 'tsconfig.json');
    await fs.writeFile(tsconfigFile, JSON.stringify(tsconfigContent, null, 2));
    files.push(tsconfigFile);

    return files;
  }

  private async scaffoldReactApp(projectDir: string, features: string[]): Promise<string[]> {
    const files: string[] = [];
    
    // Create src directory
    const srcDir = path.join(projectDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });

    // Main App.tsx
    const appContent = `import React from 'react';
import './App.css';

function App() {
  return (
    <div className="App">
      <header className="App-header">
        <h1>Welcome to React</h1>
        <p>Your app is ready to go!</p>
      </header>
    </div>
  );
}

export default App;`;

    const appFile = path.join(srcDir, 'App.tsx');
    await fs.writeFile(appFile, appContent);
    files.push(appFile);

    // Main index.tsx
    const indexContent = `import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);`;

    const indexFile = path.join(srcDir, 'index.tsx');
    await fs.writeFile(indexFile, indexContent);
    files.push(indexFile);

    return files;
  }

  private async scaffoldExpressServer(projectDir: string, features: string[]): Promise<string[]> {
    // Similar to scaffoldNodeApi but with more Express-specific structure
    return await this.scaffoldNodeApi(projectDir, features);
  }
}