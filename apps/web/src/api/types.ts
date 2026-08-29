import type { components } from './schema'

export type DevelopmentSession = components['schemas']['DevelopmentSession']
export type Project = components['schemas']['Project']
export type ProjectPage = components['schemas']['ProjectPage']
export type CreateProjectRequest = components['schemas']['CreateProjectRequest']
export type UpdateProjectRequest = components['schemas']['UpdateProjectRequest']
export type EditableProjectFields = Omit<UpdateProjectRequest, 'expected_version'>
export type ProjectStatus = components['schemas']['ProjectStatus']
export type Task = components['schemas']['Task']
export type TaskPage = components['schemas']['TaskPage']
export type CreateTaskRequest = components['schemas']['CreateTaskRequest']
export type UpdateTaskRequest = components['schemas']['UpdateTaskRequest']
export type EditableTaskFields = Omit<UpdateTaskRequest, 'expected_version'>
export type TaskPriority = components['schemas']['TaskPriority']
export type TaskRecurrence = components['schemas']['TaskRecurrence']
export type TaskStatus = components['schemas']['TaskStatus']
