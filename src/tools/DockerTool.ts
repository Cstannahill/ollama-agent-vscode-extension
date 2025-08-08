import { BaseTool } from "../core/BaseTool";
import { z } from "zod";
import { logger } from "../utils/logger";
import * as vscode from "vscode";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";

const execAsync = promisify(exec);

// Docker Container Management Tool
export class DockerContainerTool extends BaseTool {
  name = "docker_container";
  description = "Manage Docker containers (list, start, stop, remove, logs)";
  
  schema = z.object({
    action: z.enum(["list", "start", "stop", "restart", "remove", "logs", "inspect", "stats"]).describe("Action to perform"),
    container: z.string().optional().describe("Container name or ID (required for most actions)"),
    image: z.string().optional().describe("Docker image name (for run action)"),
    ports: z.array(z.string()).optional().describe("Port mappings (e.g., ['8080:80'])"),
    volumes: z.array(z.string()).optional().describe("Volume mappings (e.g., ['/host/path:/container/path'])"),
    environment: z.record(z.string(), z.string()).optional().describe("Environment variables"),
    detached: z.boolean().optional().describe("Run in detached mode (default: true)"),
    tail: z.number().optional().describe("Number of log lines to tail (default: 100)"),
  });

  async execute(params: z.infer<typeof this.schema>): Promise<string> {
    try {
      const { action, container, image, ports = [], volumes = [], environment = {}, detached = true, tail = 100 } = params;
      
      logger.info(`[DOCKER_CONTAINER] Performing ${action} operation`);

      // Check if Docker is available
      await this.checkDockerAvailable();

      switch (action) {
        case "list":
          return await this.listContainers();
        case "start":
          return await this.startContainer(container!);
        case "stop":
          return await this.stopContainer(container!);
        case "restart":
          return await this.restartContainer(container!);
        case "remove":
          return await this.removeContainer(container!);
        case "logs":
          return await this.getContainerLogs(container!, tail);
        case "inspect":
          return await this.inspectContainer(container!);
        case "stats":
          return await this.getContainerStats(container);
        default:
          throw new Error(`Unsupported action: ${action}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("[DOCKER_CONTAINER] Failed:", error);
      throw new Error(`Docker container operation failed: ${errorMessage}`);
    }
  }

  private async checkDockerAvailable(): Promise<void> {
    try {
      await execAsync("docker --version");
    } catch (error) {
      throw new Error("Docker is not installed or not running. Please install Docker and ensure it's running.");
    }
  }

  private async listContainers(): Promise<string> {
    const { stdout } = await execAsync("docker ps -a --format 'table {{.ID}}\\t{{.Image}}\\t{{.Command}}\\t{{.CreatedAt}}\\t{{.Status}}\\t{{.Ports}}\\t{{.Names}}'");
    return `Docker Containers:\n\n${stdout}`;
  }

  private async startContainer(container: string): Promise<string> {
    try {
      const { stdout } = await execAsync(`docker start ${container}`);
      return `Container '${container}' started successfully:\n${stdout}`;
    } catch (error) {
      throw new Error(`Failed to start container '${container}': ${error}`);
    }
  }

  private async stopContainer(container: string): Promise<string> {
    try {
      const { stdout } = await execAsync(`docker stop ${container}`);
      return `Container '${container}' stopped successfully:\n${stdout}`;
    } catch (error) {
      throw new Error(`Failed to stop container '${container}': ${error}`);
    }
  }

  private async restartContainer(container: string): Promise<string> {
    try {
      const { stdout } = await execAsync(`docker restart ${container}`);
      return `Container '${container}' restarted successfully:\n${stdout}`;
    } catch (error) {
      throw new Error(`Failed to restart container '${container}': ${error}`);
    }
  }

  private async removeContainer(container: string): Promise<string> {
    try {
      const { stdout } = await execAsync(`docker rm ${container}`);
      return `Container '${container}' removed successfully:\n${stdout}`;
    } catch (error) {
      throw new Error(`Failed to remove container '${container}': ${error}`);
    }
  }

  private async getContainerLogs(container: string, tail: number): Promise<string> {
    try {
      const { stdout } = await execAsync(`docker logs --tail ${tail} ${container}`);
      return `Logs for container '${container}' (last ${tail} lines):\n\n${stdout}`;
    } catch (error) {
      throw new Error(`Failed to get logs for container '${container}': ${error}`);
    }
  }

  private async inspectContainer(container: string): Promise<string> {
    try {
      const { stdout } = await execAsync(`docker inspect ${container}`);
      const inspectData = JSON.parse(stdout)[0];
      
      return `Container Inspection: ${container}\n\n` +
        `ID: ${inspectData.Id}\n` +
        `Image: ${inspectData.Config.Image}\n` +
        `Status: ${inspectData.State.Status}\n` +
        `Created: ${inspectData.Created}\n` +
        `Started: ${inspectData.State.StartedAt}\n` +
        `Ports: ${JSON.stringify(inspectData.NetworkSettings.Ports, null, 2)}\n` +
        `Environment: ${inspectData.Config.Env.join('\n')}\n`;
    } catch (error) {
      throw new Error(`Failed to inspect container '${container}': ${error}`);
    }
  }

  private async getContainerStats(container?: string): Promise<string> {
    try {
      const command = container 
        ? `docker stats ${container} --no-stream --format 'table {{.Container}}\\t{{.CPUPerc}}\\t{{.MemUsage}}\\t{{.MemPerc}}\\t{{.NetIO}}\\t{{.BlockIO}}'`
        : `docker stats --no-stream --format 'table {{.Container}}\\t{{.CPUPerc}}\\t{{.MemUsage}}\\t{{.MemPerc}}\\t{{.NetIO}}\\t{{.BlockIO}}'`;
      
      const { stdout } = await execAsync(command);
      return `Container Statistics:\n\n${stdout}`;
    } catch (error) {
      throw new Error(`Failed to get container stats: ${error}`);
    }
  }
}

// Docker Image Management Tool
export class DockerImageTool extends BaseTool {
  name = "docker_image";
  description = "Manage Docker images (list, pull, build, remove, push)";
  
  schema = z.object({
    action: z.enum(["list", "pull", "build", "remove", "push", "inspect", "history"]).describe("Action to perform"),
    image: z.string().optional().describe("Image name or ID"),
    tag: z.string().optional().describe("Image tag (default: latest)"),
    dockerfile: z.string().optional().describe("Path to Dockerfile (for build action)"),
    context: z.string().optional().describe("Build context directory (default: current directory)"),
    buildArgs: z.record(z.string(), z.string()).optional().describe("Build arguments"),
    registry: z.string().optional().describe("Registry URL for push/pull"),
  });

  async execute(params: z.infer<typeof this.schema>): Promise<string> {
    try {
      const { action, image, tag = "latest", dockerfile = "Dockerfile", context = ".", buildArgs = {}, registry } = params;
      
      logger.info(`[DOCKER_IMAGE] Performing ${action} operation`);

      // Check if Docker is available
      await this.checkDockerAvailable();

      switch (action) {
        case "list":
          return await this.listImages();
        case "pull":
          return await this.pullImage(image!, tag, registry);
        case "build":
          return await this.buildImage(image!, tag, dockerfile, context, buildArgs);
        case "remove":
          return await this.removeImage(image!);
        case "push":
          return await this.pushImage(image!, tag, registry);
        case "inspect":
          return await this.inspectImage(image!);
        case "history":
          return await this.getImageHistory(image!);
        default:
          throw new Error(`Unsupported action: ${action}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("[DOCKER_IMAGE] Failed:", error);
      throw new Error(`Docker image operation failed: ${errorMessage}`);
    }
  }

  private async checkDockerAvailable(): Promise<void> {
    try {
      await execAsync("docker --version");
    } catch (error) {
      throw new Error("Docker is not installed or not running. Please install Docker and ensure it's running.");
    }
  }

  private async listImages(): Promise<string> {
    const { stdout } = await execAsync("docker images --format 'table {{.Repository}}\\t{{.Tag}}\\t{{.ID}}\\t{{.CreatedAt}}\\t{{.Size}}'");
    return `Docker Images:\n\n${stdout}`;
  }

  private async pullImage(image: string, tag: string, registry?: string): Promise<string> {
    try {
      const imageWithTag = `${image}:${tag}`;
      const fullImage = registry ? `${registry}/${imageWithTag}` : imageWithTag;
      
      const { stdout, stderr } = await execAsync(`docker pull ${fullImage}`, {
        timeout: 300000, // 5 minutes timeout for image pulls
        maxBuffer: 1024 * 1024 * 10, // 10MB buffer
      });
      
      return `Image '${fullImage}' pulled successfully:\n${stdout}\n${stderr}`;
    } catch (error) {
      throw new Error(`Failed to pull image '${image}:${tag}': ${error}`);
    }
  }

  private async buildImage(image: string, tag: string, dockerfile: string, context: string, buildArgs: Record<string, string>): Promise<string> {
    try {
      const workspacePath = this.getWorkspaceRoot();
      const buildContext = path.resolve(workspacePath, context);
      const dockerfilePath = path.resolve(buildContext, dockerfile);
      
      // Check if Dockerfile exists
      try {
        await fs.access(dockerfilePath);
      } catch (error) {
        throw new Error(`Dockerfile not found at: ${dockerfilePath}`);
      }

      const imageWithTag = `${image}:${tag}`;
      
      // Build the command
      let command = `docker build -t ${imageWithTag} -f ${dockerfile}`;
      
      // Add build args
      Object.entries(buildArgs).forEach(([key, value]) => {
        command += ` --build-arg ${key}=${value}`;
      });
      
      command += ` ${context}`;
      
      const { stdout, stderr } = await execAsync(command, {
        cwd: workspacePath,
        timeout: 600000, // 10 minutes timeout for builds
        maxBuffer: 1024 * 1024 * 50, // 50MB buffer for large build outputs
      });
      
      return `Image '${imageWithTag}' built successfully:\n${stdout}\n${stderr}`;
    } catch (error) {
      throw new Error(`Failed to build image '${image}:${tag}': ${error}`);
    }
  }

  private async removeImage(image: string): Promise<string> {
    try {
      const { stdout } = await execAsync(`docker rmi ${image}`);
      return `Image '${image}' removed successfully:\n${stdout}`;
    } catch (error) {
      throw new Error(`Failed to remove image '${image}': ${error}`);
    }
  }

  private async pushImage(image: string, tag: string, registry?: string): Promise<string> {
    try {
      const imageWithTag = `${image}:${tag}`;
      const fullImage = registry ? `${registry}/${imageWithTag}` : imageWithTag;
      
      const { stdout, stderr } = await execAsync(`docker push ${fullImage}`, {
        timeout: 300000, // 5 minutes timeout for pushes
        maxBuffer: 1024 * 1024 * 10, // 10MB buffer
      });
      
      return `Image '${fullImage}' pushed successfully:\n${stdout}\n${stderr}`;
    } catch (error) {
      throw new Error(`Failed to push image '${image}:${tag}': ${error}`);
    }
  }

  private async inspectImage(image: string): Promise<string> {
    try {
      const { stdout } = await execAsync(`docker inspect ${image}`);
      const inspectData = JSON.parse(stdout)[0];
      
      return `Image Inspection: ${image}\n\n` +
        `ID: ${inspectData.Id}\n` +
        `Created: ${inspectData.Created}\n` +
        `Size: ${inspectData.Size} bytes\n` +
        `Architecture: ${inspectData.Architecture}\n` +
        `OS: ${inspectData.Os}\n` +
        `Layers: ${inspectData.RootFS.Layers.length}\n` +
        `Exposed Ports: ${JSON.stringify(inspectData.Config.ExposedPorts || {}, null, 2)}\n`;
    } catch (error) {
      throw new Error(`Failed to inspect image '${image}': ${error}`);
    }
  }

  private async getImageHistory(image: string): Promise<string> {
    try {
      const { stdout } = await execAsync(`docker history ${image} --format 'table {{.ID}}\\t{{.CreatedBy}}\\t{{.Size}}\\t{{.Comment}}'`);
      return `Image History: ${image}\n\n${stdout}`;
    } catch (error) {
      throw new Error(`Failed to get history for image '${image}': ${error}`);
    }
  }
}

// Docker Compose Tool
export class DockerComposeTool extends BaseTool {
  name = "docker_compose";
  description = "Manage Docker Compose services (up, down, logs, ps, build)";
  
  schema = z.object({
    action: z.enum(["up", "down", "start", "stop", "restart", "logs", "ps", "build", "pull", "exec"]).describe("Action to perform"),
    service: z.string().optional().describe("Specific service name (optional)"),
    file: z.string().optional().describe("Docker compose file path (default: docker-compose.yml)"),
    detached: z.boolean().optional().describe("Run in detached mode (default: true)"),
    build: z.boolean().optional().describe("Build images before starting"),
    tail: z.number().optional().describe("Number of log lines to tail (default: 100)"),
    command: z.string().optional().describe("Command to execute (for exec action)"),
  });

  async execute(params: z.infer<typeof this.schema>): Promise<string> {
    try {
      const { action, service, file = "docker-compose.yml", detached = true, build = false, tail = 100, command } = params;
      
      logger.info(`[DOCKER_COMPOSE] Performing ${action} operation`);

      // Check if Docker Compose is available
      await this.checkDockerComposeAvailable();

      // Check if compose file exists
      const workspacePath = this.getWorkspaceRoot();
      const composePath = path.resolve(workspacePath, file);
      
      try {
        await fs.access(composePath);
      } catch (error) {
        throw new Error(`Docker Compose file not found: ${composePath}`);
      }

      switch (action) {
        case "up":
          return await this.composeUp(file, service, detached, build);
        case "down":
          return await this.composeDown(file);
        case "start":
          return await this.composeStart(file, service);
        case "stop":
          return await this.composeStop(file, service);
        case "restart":
          return await this.composeRestart(file, service);
        case "logs":
          return await this.composeLogs(file, service, tail);
        case "ps":
          return await this.composePs(file);
        case "build":
          return await this.composeBuild(file, service);
        case "pull":
          return await this.composePull(file, service);
        case "exec":
          return await this.composeExec(file, service!, command!);
        default:
          throw new Error(`Unsupported action: ${action}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("[DOCKER_COMPOSE] Failed:", error);
      throw new Error(`Docker Compose operation failed: ${errorMessage}`);
    }
  }

  private async checkDockerComposeAvailable(): Promise<void> {
    try {
      await execAsync("docker-compose --version");
    } catch (error) {
      try {
        await execAsync("docker compose version");
      } catch (error2) {
        throw new Error("Docker Compose is not installed. Please install Docker Compose.");
      }
    }
  }

  private async composeUp(file: string, service?: string, detached: boolean = true, build: boolean = false): Promise<string> {
    try {
      const workspacePath = this.getWorkspaceRoot();
      let command = `docker-compose -f ${file} up`;
      
      if (detached) command += " -d";
      if (build) command += " --build";
      if (service) command += ` ${service}`;
      
      const { stdout, stderr } = await execAsync(command, {
        cwd: workspacePath,
        timeout: 300000, // 5 minutes timeout
        maxBuffer: 1024 * 1024 * 10, // 10MB buffer
      });
      
      return `Docker Compose up completed:\n${stdout}\n${stderr}`;
    } catch (error) {
      throw new Error(`Failed to run docker-compose up: ${error}`);
    }
  }

  private async composeDown(file: string): Promise<string> {
    try {
      const workspacePath = this.getWorkspaceRoot();
      const { stdout, stderr } = await execAsync(`docker-compose -f ${file} down`, {
        cwd: workspacePath,
      });
      
      return `Docker Compose down completed:\n${stdout}\n${stderr}`;
    } catch (error) {
      throw new Error(`Failed to run docker-compose down: ${error}`);
    }
  }

  private async composeStart(file: string, service?: string): Promise<string> {
    try {
      const workspacePath = this.getWorkspaceRoot();
      const command = `docker-compose -f ${file} start${service ? ` ${service}` : ""}`;
      const { stdout, stderr } = await execAsync(command, { cwd: workspacePath });
      
      return `Docker Compose start completed:\n${stdout}\n${stderr}`;
    } catch (error) {
      throw new Error(`Failed to start services: ${error}`);
    }
  }

  private async composeStop(file: string, service?: string): Promise<string> {
    try {
      const workspacePath = this.getWorkspaceRoot();
      const command = `docker-compose -f ${file} stop${service ? ` ${service}` : ""}`;
      const { stdout, stderr } = await execAsync(command, { cwd: workspacePath });
      
      return `Docker Compose stop completed:\n${stdout}\n${stderr}`;
    } catch (error) {
      throw new Error(`Failed to stop services: ${error}`);
    }
  }

  private async composeRestart(file: string, service?: string): Promise<string> {
    try {
      const workspacePath = this.getWorkspaceRoot();
      const command = `docker-compose -f ${file} restart${service ? ` ${service}` : ""}`;
      const { stdout, stderr } = await execAsync(command, { cwd: workspacePath });
      
      return `Docker Compose restart completed:\n${stdout}\n${stderr}`;
    } catch (error) {
      throw new Error(`Failed to restart services: ${error}`);
    }
  }

  private async composeLogs(file: string, service?: string, tail: number = 100): Promise<string> {
    try {
      const workspacePath = this.getWorkspaceRoot();
      const command = `docker-compose -f ${file} logs --tail ${tail}${service ? ` ${service}` : ""}`;
      const { stdout, stderr } = await execAsync(command, { cwd: workspacePath });
      
      return `Docker Compose logs:\n${stdout}\n${stderr}`;
    } catch (error) {
      throw new Error(`Failed to get logs: ${error}`);
    }
  }

  private async composePs(file: string): Promise<string> {
    try {
      const workspacePath = this.getWorkspaceRoot();
      const { stdout } = await execAsync(`docker-compose -f ${file} ps`, { cwd: workspacePath });
      
      return `Docker Compose services:\n${stdout}`;
    } catch (error) {
      throw new Error(`Failed to list services: ${error}`);
    }
  }

  private async composeBuild(file: string, service?: string): Promise<string> {
    try {
      const workspacePath = this.getWorkspaceRoot();
      const command = `docker-compose -f ${file} build${service ? ` ${service}` : ""}`;
      const { stdout, stderr } = await execAsync(command, {
        cwd: workspacePath,
        timeout: 600000, // 10 minutes timeout for builds
        maxBuffer: 1024 * 1024 * 50, // 50MB buffer
      });
      
      return `Docker Compose build completed:\n${stdout}\n${stderr}`;
    } catch (error) {
      throw new Error(`Failed to build services: ${error}`);
    }
  }

  private async composePull(file: string, service?: string): Promise<string> {
    try {
      const workspacePath = this.getWorkspaceRoot();
      const command = `docker-compose -f ${file} pull${service ? ` ${service}` : ""}`;
      const { stdout, stderr } = await execAsync(command, {
        cwd: workspacePath,
        timeout: 300000, // 5 minutes timeout
      });
      
      return `Docker Compose pull completed:\n${stdout}\n${stderr}`;
    } catch (error) {
      throw new Error(`Failed to pull images: ${error}`);
    }
  }

  private async composeExec(file: string, service: string, command: string): Promise<string> {
    try {
      const workspacePath = this.getWorkspaceRoot();
      const { stdout, stderr } = await execAsync(`docker-compose -f ${file} exec ${service} ${command}`, {
        cwd: workspacePath,
      });
      
      return `Command executed in ${service}:\n${stdout}\n${stderr}`;
    } catch (error) {
      throw new Error(`Failed to execute command in ${service}: ${error}`);
    }
  }
}